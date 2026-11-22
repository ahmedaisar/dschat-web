import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Pool } from 'pg'

const json = (response: ServerResponse, status: number, body: unknown): void => {
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.end(JSON.stringify(body))
}

// Temporary Preview-only migration endpoint. Remove after the initial baseline is applied.
// eslint-disable-next-line import/no-default-export
export default async function migrateHandler(
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST')
    json(response, 405, { error: 'method_not_allowed' })
    return
  }
  const expected = process.env.MIGRATION_TOKEN?.trim()
  const supplied = typeof request.headers.authorization === 'string'
    ? request.headers.authorization.replace(/^Bearer\s+/i, '').trim()
    : ''
  if (!expected || supplied !== expected) {
    json(response, 404, { error: 'not_found' })
    return
  }
  const url = process.env.DATABASE_MIGRATION_URL ?? process.env.POSTGRES_URL_NON_POOLING ?? process.env.DATABASE_URL
  if (!url) {
    json(response, 503, { error: 'database_unavailable' })
    return
  }
  const pool = new Pool({ connectionString: url, max: 1 })
  try {
    await migrate(drizzle(pool), { migrationsFolder: 'api/db/migrations' })
    json(response, 200, { ok: true })
  } catch (error) {
    console.error('[api/db/migrate] failed', error instanceof Error ? error.message : 'unknown error')
    json(response, 500, { error: 'migration_failed' })
  } finally {
    await pool.end()
  }
}
