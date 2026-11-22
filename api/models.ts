import { eq } from 'drizzle-orm'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { getDb } from './_lib/db.js'
import { AuthorizationError, requireUser } from './_lib/authorization.js'
import { model } from './db/schema.js'

const json = (response: ServerResponse, status: number, body: unknown): void => {
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', 'no-store')
  response.end(JSON.stringify(body))
}
const headers = (request: IncomingMessage): Headers => new Headers(Object.entries(request.headers).flatMap(([key, value]) => typeof value === 'string' ? [[key, value]] : value ? [[key, value.join(', ')]] : []))

// eslint-disable-next-line import/no-default-export
export default async function models(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (request.method !== 'GET') { response.setHeader('Allow', 'GET'); json(response, 405, { error: 'method_not_allowed' }); return }
  try {
    await requireUser(headers(request))
    const rows = await getDb().select().from(model).where(eq(model.enabled, true))
    json(response, 200, { models: rows.map((item) => ({ ...item, inputRate: item.inputRate.toString(), outputRate: item.outputRate.toString(), reasoningRate: item.reasoningRate.toString(), cachedInputRate: item.cachedInputRate.toString() })) })
  } catch (error) {
    json(response, error instanceof AuthorizationError ? error.status : 503, { error: error instanceof AuthorizationError && error.status === 401 ? 'unauthorized' : 'service_unavailable' })
  }
}
