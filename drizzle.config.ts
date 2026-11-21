import { defineConfig } from 'drizzle-kit'

const connectionString = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL

export default defineConfig({
  dialect: 'postgresql',
  schema: './api/db/schema.ts',
  out: './api/db/migrations',
  dbCredentials: {
    url: connectionString ?? '',
  },
  strict: true,
  verbose: true,
})
