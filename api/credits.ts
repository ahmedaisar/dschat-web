import { eq } from 'drizzle-orm'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { getDb } from './_lib/db.js'
import { AuthorizationError, requireUser } from './_lib/authorization.js'
import { creditAccount } from './db/schema.js'

const json = (response: ServerResponse, status: number, body: unknown): void => {
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', 'no-store')
  response.end(JSON.stringify(body))
}
const headers = (request: IncomingMessage): Headers => new Headers(Object.entries(request.headers).flatMap(([key, value]) => typeof value === 'string' ? [[key, value]] : value ? [[key, value.join(', ')]] : []))

// eslint-disable-next-line import/no-default-export
export default async function credits(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (request.method !== 'GET') { response.setHeader('Allow', 'GET'); json(response, 405, { error: 'method_not_allowed' }); return }
  try {
    const user = await requireUser(headers(request))
    const row = await getDb().query.creditAccount.findFirst({ where: eq(creditAccount.userId, user.id) })
    json(response, 200, { userId: user.id, available: (row?.available ?? 0n).toString(), reserved: (row?.reserved ?? 0n).toString() })
  } catch (error) {
    json(response, error instanceof AuthorizationError ? error.status : 503, { error: error instanceof AuthorizationError && error.status === 401 ? 'unauthorized' : 'service_unavailable' })
  }
}
