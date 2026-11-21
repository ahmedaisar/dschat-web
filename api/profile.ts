import type { IncomingMessage, ServerResponse } from 'node:http'
import { AuthorizationError, requireUser } from './_lib/authorization.js'

const writeJson = (response: ServerResponse, status: number, body: unknown): void => {
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', 'no-store')
  response.end(JSON.stringify(body))
}

const requestHeaders = (request: IncomingMessage): Headers => {
  const headers = new Headers()
  for (const [name, value] of Object.entries(request.headers)) {
    if (typeof value === 'string') {
      headers.set(name, value)
    } else if (Array.isArray(value)) {
      headers.set(name, value.join(', '))
    }
  }
  return headers
}

// eslint-disable-next-line import/no-default-export
export default async function profile(
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET')
    writeJson(response, 405, { error: 'method_not_allowed' })
    return
  }
  try {
    const user = await requireUser(requestHeaders(request))
    writeJson(response, 200, { user })
  } catch (error) {
    if (error instanceof AuthorizationError) {
      writeJson(response, error.status, {
        error:
          error.status === 401
            ? 'unauthorized'
            : error.status === 403
              ? 'forbidden'
              : 'service_unavailable',
      })
      return
    }
    writeJson(response, 503, { error: 'service_unavailable' })
  }
}
