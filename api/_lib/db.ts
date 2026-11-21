import { attachDatabasePool } from '@vercel/functions'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { schema } from '../db/schema.js'
import { readServerConfig } from './config.js'

let pool: Pool | null = null
let database: NodePgDatabase<typeof schema> | null = null

/** One bounded pool per warm Vercel function instance; never create a pool per request. */
export const getPool = (): Pool => {
  if (pool) {
    return pool
  }
  const url = readServerConfig().databaseUrl
  if (!url) {
    throw new Error('DATABASE_URL is not configured')
  }
  pool = new Pool({
    connectionString: url,
    max: 5,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 5_000,
  })
  attachDatabasePool(pool)
  return pool
}

/** Typed Drizzle database wrapper around the shared Vercel/Neon pool. */
export const getDb = (): NodePgDatabase<typeof schema> => {
  if (database) {
    return database
  }
  database = drizzle(getPool(), { schema })
  return database
}
