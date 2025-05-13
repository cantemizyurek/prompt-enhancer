import { readdir, writeFile } from 'fs/promises'
import { chunkText, loadPdf } from '../utils'
import { fileURLToPath } from 'url'
import path from 'path'
import { openai } from '@ai-sdk/openai'
import { generateObject } from 'ai'
import { z } from 'zod'
import { config } from 'dotenv'

config({ path: ['.env.development', '.env'] })

const PAPERS_DIR = fileURLToPath(new URL('../../data/papers', import.meta.url))

interface PaperChunk {
  id: string
  content: string
  paperFile: string
  chunkIndex: number
}

const papers: { content: string; file: string }[] = []

const files = await readdir(PAPERS_DIR)

console.log(`Starting to load ${files.length} papers...`)

await Promise.all(
  files.map(async (file) => {
    const content = await loadPdf(path.join(PAPERS_DIR, file))
    papers.push({ content, file })
    console.log(`Loaded ${papers.length} papers (Left: ${files.length - papers.length})`)
  })
)

console.log(`Starting to chunk ${papers.length} papers...`)

const chunks: PaperChunk[] = papers.flatMap((paper, paperIndex) => {
  const textChunks = chunkText(paper.content)
  return textChunks.map((chunk, chunkIndex) => ({
    id: `paper_${paperIndex}_chunk_${chunkIndex}`,
    content: chunk,
    paperFile: paper.file,
    chunkIndex
  }))
})

console.log(`Created ${chunks.length} chunks with unique identifiers`)

const shuffledChunks = [...chunks].sort(() => Math.random() - 0.5)

const trainEndIndex = Math.floor(shuffledChunks.length * 0.7)
const valEndIndex = Math.floor(shuffledChunks.length * 0.85)

const trainingSet = shuffledChunks.slice(0, trainEndIndex)
const validationSet = shuffledChunks.slice(trainEndIndex, valEndIndex)
const testSet = shuffledChunks.slice(valEndIndex)

console.log(
  `
Data split complete:
- Training set: ${trainingSet.length} chunks (70%)
- Validation set: ${validationSet.length} chunks (15%)
- Test set: ${testSet.length} chunks (15%)
`.trim()
)

const questions: Record<string, string[]> = {}

await Promise.all(
  trainingSet.map(async (chunk) => {
    const response = await generateQaPair(chunk, 2)
    questions[chunk.id] = response
  })
)

const dataDir = fileURLToPath(new URL('../../data/embed', import.meta.url))

await writeFile(path.join(dataDir, 'questions.json'), JSON.stringify(questions, null, 2))
await writeFile(path.join(dataDir, 'training-set.json'), JSON.stringify(trainingSet, null, 2))
await writeFile(path.join(dataDir, 'validation-set.json'), JSON.stringify(validationSet, null, 2))
await writeFile(path.join(dataDir, 'test-set.json'), JSON.stringify(testSet, null, 2))

async function generateQaPair(chunks: PaperChunk, numberOfQuestions: number) {
  const response = await generateObject<{ questions: string[] }>({
    model: openai('gpt-4.1'),
    prompt: `
Given the following context, you must generate questions based on only the provided context.

You are to generate ${numberOfQuestions} questions which should be provided in the following format:

1. QUESTION #1
2. QUESTION #2

Context:
${chunks.content}
    `.trim(),
    temperature: 0,
    schema: z.object({
      questions: z.array(z.string().describe('The questions to be generated')).describe('The questions to be generated')
    })
  })

  return response.object.questions
}
