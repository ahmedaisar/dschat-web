import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import pg from 'pg'

const { Pool } = pg
const isLocal = (process.env.NODE_ENV ?? 'development') !== 'production'
const url = process.env.DATABASE_MIGRATION_URL ?? (isLocal ? process.env.DATABASE_URL : undefined)
if (!url) {
  throw new Error('DATABASE_MIGRATION_URL is required for non-local migrations')
}

const root = path.dirname(fileURLToPath(import.meta.url))
const migrationsDir = path.join(root, '..', 'api', 'db', 'migrations')
const files = (await readdir(migrationsDir))
  .filter((file) => /^\d+_.+\.sql$/.test(file))
  .sort()
const pool = new Pool({ connectionString: url, max: 1 })
try {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "app_migrations" (
      "id" text PRIMARY KEY NOT NULL,
      "applied_at" timestamptz NOT NULL DEFAULT now()
    )
  `)
  for (const file of files) {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['chat-demo:migrations'])
      const applied = await client.query('SELECT 1 FROM "app_migrations" WHERE "id" = $1', [file])
      if (applied.rowCount === 0) {
        const sql = await readFile(path.join(migrationsDir, file), 'utf8')
        await client.query(sql)
        await client.query('INSERT INTO "app_migrations" ("id") VALUES ($1)', [file])
        console.log(`Applied ${file}`)
      } else {
        console.log(`Skipped ${file}`)
      }
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }
} finally {
  await pool.end()
}
