/* eslint-disable curly */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { AuthorizationError, requireUser } from '../_lib/authorization.js'
import { ReservationError, reserveCredits } from '../_lib/credits/reservations.js'

const json = (response: ServerResponse, status: number, body: unknown): void => { response.statusCode = status; response.setHeader('Content-Type', 'application/json; charset=utf-8'); response.setHeader('Cache-Control', 'no-store'); response.end(JSON.stringify(body)) }
const headers = (request: IncomingMessage): Headers => new Headers(Object.entries(request.headers).flatMap(([key, value]) => typeof value === 'string' ? [[key, value]] : value ? [[key, value.join(', ')]] : []))
const readBody = async (request: IncomingMessage): Promise<unknown> => { let body = ''; for await (const chunk of request) body += chunk; if (body.length > 256_000) throw new ReservationError('invalid_request', 400, 'Request body is too large'); try { return JSON.parse(body) } catch { throw new ReservationError('invalid_request', 400, 'Invalid JSON body') } }

// eslint-disable-next-line import/no-default-export
export default async function reserve(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (request.method !== 'POST') { response.setHeader('Allow', 'POST'); json(response, 405, { error: 'method_not_allowed' }); return }
  try {
    const user = await requireUser(headers(request))
    const key = request.headers['idempotency-key']
    if (typeof key !== 'string') throw new ReservationError('invalid_idempotency_key', 400, 'Idempotency-Key is required')
    const result = await reserveCredits(user.id, key, await readBody(request) as { modelId: string; messages: unknown[]; maxOutputTokens?: number })
    json(response, result.replayed ? 200 : 201, { reservationId: result.id, maximum: result.maximum.toString(), expiresAt: result.expiresAt.toISOString(), replayed: result.replayed })
  } catch (error) {
    if (error instanceof AuthorizationError) { json(response, error.status, { error: error.status === 401 ? 'unauthorized' : 'service_unavailable' }); return }
    if (error instanceof ReservationError) { json(response, error.status, { error: error.code, message: error.message }); return }
    // eslint-disable-next-line no-console
    console.error('[api/inference/reserve] failed', error instanceof Error ? error.message : 'unknown error')
    json(response, 503, { error: 'service_unavailable' })
  }
}
