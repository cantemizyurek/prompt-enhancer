import 'dotenv/config'
import fs from 'node:fs/promises'
import path from 'node:path'
import { db } from '../db'
import { papers, paperChunks } from '../db/schema'
import { openai } from '@ai-sdk/openai'
import { embed } from 'ai'
import PDFParser from 'pdf2json'

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
const MAX_CHUNK_CHARACTERS = 1500
const SENTENCE_OVERLAP_COUNT = 3

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

function chunkText(text: string): string[] {
  const MAX_CHARS = MAX_CHUNK_CHARACTERS
  const OVERLAP_COUNT = SENTENCE_OVERLAP_COUNT

  if (!text.trim()) {
    return []
  }
  const sentences =
    text
      .match(/[^.!?]+[.!?]?(\s+|$)/g)
      ?.map((s) => s.trim())
      .filter((s) => s.length > 0) || []

  if (sentences.length === 0) {
    return chunkRawText(text, MAX_CHARS)
  }

  return chunkSentences(sentences, MAX_CHARS, OVERLAP_COUNT)
}

function chunkRawText(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) {
    return [text.trim()].filter((c) => c.length > 0)
  }

  const chunk = text.substring(0, maxChars).trim()
  const remaining = text.substring(maxChars).trim()

  return chunk.length > 0 ? [chunk, ...chunkRawText(remaining, maxChars)] : chunkRawText(remaining, maxChars)
}

function chunkSentences(
  sentences: string[],
  maxChars: number,
  overlapCount: number,
  accumulatedChunks: string[] = [],
  currentChunk: string[] = []
): string[] {
  if (sentences.length === 0) {
    if (currentChunk.length === 0) {
      return accumulatedChunks
    }

    const finalChunk = currentChunk.join(' ').trim()
    if (finalChunk.length > maxChars) {
      return [...accumulatedChunks, ...chunkRawText(finalChunk, maxChars)]
    }
    return [...accumulatedChunks, finalChunk]
  }

  const sentence = sentences[0]
  const remainingSentences = sentences.slice(1)

  if (sentence.length > maxChars) {
    const pendingChunks = currentChunk.length > 0 ? [currentChunk.join(' ').trim()] : []

    const sentenceChunks = chunkRawText(sentence, maxChars)

    return chunkSentences(
      remainingSentences,
      maxChars,
      overlapCount,
      [...accumulatedChunks, ...pendingChunks.filter((c) => c.length > 0), ...sentenceChunks],
      []
    )
  }

  const prospectiveChunk = [...currentChunk, sentence]
  const prospectiveLength = prospectiveChunk.join(' ').length

  if (prospectiveLength <= maxChars) {
    return chunkSentences(remainingSentences, maxChars, overlapCount, accumulatedChunks, prospectiveChunk)
  }

  const chunkText = currentChunk.join(' ').trim()
  if (chunkText.length > 0) {
    const overlapSentences = currentChunk.slice(-Math.min(overlapCount, currentChunk.length))

    return chunkSentences(
      remainingSentences,
      maxChars,
      overlapCount,
      [...accumulatedChunks, chunkText],
      overlapSentences
    )
  }

  return chunkSentences(
    remainingSentences,
    maxChars,
    overlapCount,
    [...accumulatedChunks, ...chunkRawText(sentence, maxChars)],
    []
  )
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
