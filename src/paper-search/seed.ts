import 'dotenv/config'
import fs from 'node:fs/promises'
import path from 'node:path'
import { db } from '../db'
import { papers, paperChunks } from '../db/schema'
import { openai } from '@ai-sdk/openai'
import { embed } from 'ai'
import PDFParser from 'pdf2json'
import { chunkText } from '../utils'

interface PDFPage {
  Texts?: Array<{
    R?: Array<{
      T?: string
    }>
  }>
}

interface PDFData {
  info?: {
    Title?: string
  }
  Pages?: PDFPage[]
}

function extractFullText(pdfData: PDFData): string {
  return (
    pdfData.Pages?.map((page: PDFPage) =>
      page.Texts?.map((text) => decodeURIComponent(text.R?.[0]?.T || '')).join(' ')
    ).join('\n') || ''
  )
}

const PAPERS_DIR = path.join(process.cwd(), 'data', 'papers')
const EMBEDDING_DIMENSION = 1536

async function getEmbedding(text: string): Promise<number[]> {
  if (!process.env.OPENAI_API_KEY) {
    console.warn('OPENAI_API_KEY not found in environment. Using placeholder embeddings.')
    return Array.from({ length: EMBEDDING_DIMENSION }, () => Math.random() * 2 - 1)
  }
  try {
    const { embedding } = await embed({
      model: openai.embedding('text-embedding-3-small'),
      value: text
    })

    if (embedding.length !== EMBEDDING_DIMENSION) {
      console.warn(
        `Warning: Embedding dimension mismatch. Expected ${EMBEDDING_DIMENSION}, got ${embedding.length}. Consider checking your model or schema.`
      )
    }
    return embedding
  } catch (error) {
    console.error('Error generating embedding with OpenAI:', error)
    console.warn('Falling back to placeholder embedding due to error.')
    return Array.from({ length: EMBEDDING_DIMENSION }, () => Math.random() * 2 - 1)
  }
}

async function seedDatabase() {
  console.log('Starting PDF seeding process...')

  try {
    await fs.access(PAPERS_DIR)
  } catch (error) {
    console.error(`Error: The directory ${PAPERS_DIR} does not exist. Please create it and add PDF files.`)
    process.exit(1)
  }

  const pdfFiles = (await fs.readdir(PAPERS_DIR)).filter((file) => file.toLowerCase().endsWith('.pdf'))

  if (pdfFiles.length === 0) {
    console.log(`No PDF files found in ${PAPERS_DIR}. Exiting.`)
    return
  }

  console.log(`Found ${pdfFiles.length} PDF files to process.`)

  for (const pdfFile of pdfFiles) {
    const filePath = path.join(PAPERS_DIR, pdfFile)
    console.log(`Processing ${pdfFile}...`)

    try {
      const pdfParser = new PDFParser()
      const pdfData = await new Promise<PDFData>((resolve, reject) => {
        pdfParser.on('pdfParser_dataReady', (data) => resolve(data))
        pdfParser.on('pdfParser_dataError', (err) => reject(err))
        pdfParser.loadPDF(filePath)
      })
      const title =
        decodeURIComponent(pdfData.info?.Title || '') ||
        (
          pdfData.Pages?.map((page: PDFPage) =>
            page.Texts?.map((text) => decodeURIComponent(text.R?.[0]?.T || '')).join(' ')
          ).join('\n') || ''
        )
          .split('\n')
          .find((line: string) => line.trim() !== '')
          ?.trim() ||
        pdfFile.replace(/\.pdf$/i, '')

      const [insertedPaper] = await db
        .insert(papers)
        .values({
          fileName: pdfFile,
          fullText: extractFullText(pdfData)
        })
        .returning()

      if (!insertedPaper) {
        console.error(`Failed to insert paper: ${title}`)
        continue
      }

      console.log(`  Inserted paper: ${insertedPaper.id}`)

      const fullText =
        pdfData.Pages?.map((page: PDFPage) =>
          page.Texts?.map((text) => decodeURIComponent(text.R?.[0]?.T || '')).join(' ')
        ).join('\n') || ''
      const textChunks = chunkText(fullText)
      console.log(`  Created ${textChunks.length} chunks.`)

      const validChunks = textChunks.map((chunk, i) => ({ chunk, index: i })).filter(({ chunk }) => chunk.length > 0)

      const skippedChunks = textChunks.length - validChunks.length
      if (skippedChunks > 0) {
        console.warn(`Skipping ${skippedChunks} empty chunks for paper ${insertedPaper.id}`)
      }

      await Promise.all(
        validChunks.map(async ({ chunk, index: i }) => {
          const embedding = await getEmbedding(chunk)

          await db.insert(paperChunks).values({
            paperId: insertedPaper.id,
            chunkText: chunk,
            embedding: embedding,
            metadata: {
              pageNumber:
                (pdfData.Pages?.length ?? 0) > 0
                  ? Math.floor(
                      (textChunks.slice(0, i).reduce((acc, val) => acc + val.length, 0) *
                        (pdfData.Pages?.length ?? 1)) /
                        (fullText.length || 1)
                    ) + 1
                  : null,
              chunkIndex: i
            }
          })

          console.log(`    Inserted chunk ${i + 1}/${textChunks.length} (length: ${chunk.length})`)
        })
      )
    } catch (error) {
      console.error(`Error processing ${pdfFile}:`, error)
    }
  }

  console.log('PDF seeding process finished.')
}

seedDatabase()
  .then(() => {
    console.log('Seed script finished successfully.')
    process.exit(0)
  })
  .catch((err) => {
    console.error('Seed script failed:', err)
    process.exit(1)
  })
