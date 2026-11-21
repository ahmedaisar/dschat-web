import { attachDatabasePool } from '@vercel/functions'
import { Pool } from 'pg'
import { readServerConfig } from './config.js'

let pool: Pool | null = null

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
