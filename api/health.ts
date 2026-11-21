import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { readServerConfig } from './_lib/config.js'

const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/

const requestId = (request: IncomingMessage): string => {
  const header = request.headers['x-request-id']
  return typeof header === 'string' && SAFE_REQUEST_ID.test(header) ? header : randomUUID()
}

// eslint-disable-next-line import/no-default-export
export default function health(request: IncomingMessage, response: ServerResponse): void {
  const id = requestId(request)
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('X-Request-Id', id)

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.statusCode = 405
    response.setHeader('Allow', 'GET, HEAD')
    response.end(JSON.stringify({ error: 'method_not_allowed', requestId: id }))
    return
  }

  const config = readServerConfig()
  response.statusCode = 200
  response.end(
    JSON.stringify({
      ok: true,
      service: 'chat-demo-api',
      environment: config.nodeEnv,
      requestId: id,
    })
  )
}
