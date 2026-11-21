import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'

const isLocal = (process.env.NODE_ENV ?? 'development') !== 'production'
const url = process.env.DATABASE_MIGRATION_URL ?? (isLocal ? process.env.DATABASE_URL : undefined)
if (!url) {
  throw new Error('DATABASE_MIGRATION_URL is required for non-local migrations')
}

const pool = new Pool({ connectionString: url, max: 1 })
try {
  await migrate(drizzle(pool), { migrationsFolder: 'api/db/migrations' })
  console.log('Drizzle migrations applied successfully')
} finally {
  await pool.end()
}
