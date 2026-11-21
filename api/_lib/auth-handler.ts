import { toNodeHandler } from 'better-auth/node'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { getAuth } from './auth.js'

export const authNodeHandler = async (
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> => {
  try {
    await toNodeHandler((await getAuth()) as never)(request, response)
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(
      '[api/auth] request failed',
      error instanceof Error ? error.message : 'unknown error'
    )
    response.statusCode = 503
    response.setHeader('Content-Type', 'application/json; charset=utf-8')
    response.end(JSON.stringify({ error: 'service_unavailable' }))
  }
}
