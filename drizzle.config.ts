import { config } from 'dotenv'
import { defineConfig } from 'drizzle-kit'

config({ path: ['.env.development', '.env'] })

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) {
  throw new Error('DATABASE_URL is not defined')
}

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: databaseUrl
  }
})
