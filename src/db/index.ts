import * as schema from './schema'
import { config } from 'dotenv'
import { drizzle } from 'drizzle-orm/neon-http'
import { neon } from '@neondatabase/serverless'

config({ path: ['.env.development', '.env'] })

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  throw new Error('DATABASE_URL is not defined')
}

const sql = neon(databaseUrl)
export const db = drizzle({ client: sql })
export { schema }
