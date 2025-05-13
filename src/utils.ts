import PDFParser from 'pdf2json'

const MAX_CHUNK_CHARACTERS = 1500
const SENTENCE_OVERLAP_COUNT = 3

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

export async function loadPdf(path: string): Promise<string> {
  const pdfParser = new PDFParser()
  const pdfData = await new Promise<PDFData>((resolve, reject) => {
    pdfParser.on('pdfParser_dataReady', (data) => resolve(data))
    pdfParser.on('pdfParser_dataError', (err) => reject(err))
    pdfParser.loadPDF(path)
  })

  return (
    pdfData.Pages?.map((page) => page.Texts?.map((text) => decodeURIComponent(text.R?.[0]?.T || '')).join(' ')).join(
      '\n'
    ) || ''
  )
}

export function chunkText(text: string): string[] {
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
    const finalChunk = currentChunk.join(' ').trim()
    if (finalChunk.length === 0) {
      return accumulatedChunks
    }
    if (finalChunk.length > maxChars) {
      return [...accumulatedChunks, ...chunkRawText(finalChunk, maxChars)]
    }
    return [...accumulatedChunks, finalChunk]
  }

  const [sentence, ...remainingSentences] = sentences

  if (sentence.length > maxChars) {
    const currentText = currentChunk.join(' ').trim()
    const chunks = [...(currentText.length > 0 ? [currentText] : []), ...chunkRawText(sentence, maxChars)]
    return chunkSentences(remainingSentences, maxChars, overlapCount, [...accumulatedChunks, ...chunks], [])
  }

  const prospectiveChunk = [...currentChunk, sentence]
  const prospectiveText = prospectiveChunk.join(' ')

  if (prospectiveText.length <= maxChars) {
    return chunkSentences(remainingSentences, maxChars, overlapCount, accumulatedChunks, prospectiveChunk)
  }

  const currentText = currentChunk.join(' ').trim()
  if (currentText.length > 0) {
    const overlapSentences = currentChunk.slice(-Math.min(overlapCount, currentChunk.length))
    return chunkSentences(
      remainingSentences,
      maxChars,
      overlapCount,
      [...accumulatedChunks, currentText],
      [...overlapSentences, sentence]
    )
  }

  return chunkSentences(remainingSentences, maxChars, overlapCount, [...accumulatedChunks, sentence], [])
}
