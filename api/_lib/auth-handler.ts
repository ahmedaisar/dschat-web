import type { IncomingMessage, ServerResponse } from 'node:http'
import { getAuth } from './auth.js'

type VercelRequest = IncomingMessage & { body?: unknown }
type AuthHandler = (request: Request) => Promise<Response>

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

const readBody = async (request: VercelRequest): Promise<string | undefined> => {
  if (request.body !== undefined) {
    if (typeof request.body === 'string') {
      return request.body
    }
    return JSON.stringify(request.body)
  }
  if (request.method === 'GET' || request.method === 'HEAD') {
    return undefined
  }
  const chunks: string[] = []
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk))
  }
  return chunks.join('') || undefined
}

export const authNodeHandler = async (
  request: VercelRequest,
  response: ServerResponse,
  pathOverride?: string
): Promise<void> => {
  try {
    const headers = requestHeaders(request)
    const host = headers.get('host') ?? 'localhost'
    const url = new URL(request.url ?? '/', `https://${host}`)
    if (pathOverride) {
      url.pathname = pathOverride
    }
    const body = await readBody(request)
    const authRequest = new Request(url, {
      method: request.method ?? 'GET',
      headers,
      body: body && request.method !== 'GET' && request.method !== 'HEAD' ? body : undefined,
    })
    const auth = (await getAuth()) as unknown as { handler: AuthHandler }
    const authResponse = await auth.handler(authRequest)
    response.statusCode = authResponse.status
    authResponse.headers.forEach((value, name) => response.setHeader(name, value))
    response.end(Buffer.from(await authResponse.arrayBuffer()))
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(
      '[api/auth] request failed',
      error instanceof Error ? error.message : 'unknown error'
    )
    if (!response.headersSent) {
      response.statusCode = 503
      response.setHeader('Content-Type', 'application/json; charset=utf-8')
      response.end(JSON.stringify({ error: 'service_unavailable' }))
    }
  }
}
