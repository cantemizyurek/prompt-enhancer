import 'dotenv/config'
import { db } from '../db'
import { paperChunks, papers } from '../db/schema'
import { openai } from '@ai-sdk/openai'
import { embed } from 'ai'
import { eq, sql } from 'drizzle-orm'

const EMBEDDING_DIMENSION = 1536

export async function getEmbedding(text: string): Promise<number[]> {
  if (!process.env.OPENAI_API_KEY) {
    console.warn('OPENAI_API_KEY not found in environment. Using placeholder embeddings for query.')
    throw new Error('OPENAI_API_KEY not found in environment.')
  }
  try {
    const { embedding } = await embed({
      model: openai.embedding('text-embedding-3-small'),
      value: text
    })

    if (embedding.length !== EMBEDDING_DIMENSION) {
      console.warn(
        `Warning: Query embedding dimension mismatch. Expected ${EMBEDDING_DIMENSION}, got ${embedding.length}.`
      )
    }
    return embedding
  } catch (error) {
    console.error('Error generating embedding for query with OpenAI:', error)
    throw error
  }
}

export interface PaperQueryResult {
  chunkId: string
  chunkText: string
  similarity: number
  paperId: string
  paperFileName: string | null
  paperCreatedAt: Date
  chunkMetadata: unknown
}

export async function queryPapers(searchQuery: string, limit = 10): Promise<PaperQueryResult[]> {
  if (!searchQuery.trim()) {
    console.warn('Search query is empty. Returning no results.')
    return []
  }

  try {
    const queryEmbedding = await getEmbedding(searchQuery)

    const embeddingString = `[${queryEmbedding.join(',')}]`

    const results = await db
      .select({
        chunkId: paperChunks.id,
        chunkText: paperChunks.chunkText,
        similarity: sql<number>`1 - (${paperChunks.embedding} <=> ${embeddingString})`,
        paperId: papers.id,
        paperFileName: papers.fileName,
        paperCreatedAt: papers.createdAt,
        chunkMetadata: paperChunks.metadata
      })
      .from(paperChunks)
      .leftJoin(papers, eq(paperChunks.paperId, papers.id))
      .orderBy(sql`${paperChunks.embedding} <=> ${embeddingString}`)
      .limit(limit)

    return results.map((r) => {
      if (!r.paperId || !r.paperCreatedAt) {
        throw new Error('Invalid database result: missing required fields')
      }
      return {
        chunkId: r.chunkId,
        chunkText: r.chunkText,
        similarity: r.similarity,
        paperId: r.paperId,
        paperFileName: r.paperFileName ?? null,
        paperCreatedAt: r.paperCreatedAt,
        chunkMetadata: r.chunkMetadata ?? null
      }
    })
  } catch (error) {
    console.error('Error querying papers:', error)
    return []
  }
}
