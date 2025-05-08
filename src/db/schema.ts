import { pgTable, text, timestamp, vector, jsonb, index } from 'drizzle-orm/pg-core'
import crypto from 'crypto'

export const papers = pgTable('papers', {
  id: text('id')
    .primaryKey()
    .notNull()
    .$defaultFn(() => crypto.randomUUID()),
  fileName: text('file_name'),
  fullText: text('full_text'),
  createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true }).defaultNow().notNull()
})

export const paperChunks = pgTable(
  'paper_chunks',
  {
    id: text('id')
      .primaryKey()
      .notNull()
      .$defaultFn(() => crypto.randomUUID()),
    paperId: text('paper_id')
      .notNull()
      .references(() => papers.id, { onDelete: 'cascade' }),
    chunkText: text('chunk_text').notNull(),
    embedding: vector('embedding', { dimensions: 1536 }),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { mode: 'date', withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { mode: 'date', withTimezone: true }).defaultNow().notNull()
  },
  (table) => ({
    embeddingIndex: index('embedding_idx').using('hnsw', table.embedding.op('vector_cosine_ops')),
    paperIdIndex: index('paper_id_index').on(table.paperId)
  })
)
