import { readServerConfig } from './_lib/config.js'

const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/

const requestId = (request: Request): string => {
  const header = request.headers.get('x-request-id')
  return header !== null && SAFE_REQUEST_ID.test(header) ? header : globalThis.crypto.randomUUID()
}

// eslint-disable-next-line import/no-default-export
export default function health(request: Request): Response {
  const id = requestId(request)
  const headers = new Headers({
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'X-Request-Id': id,
  })

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    headers.set('Allow', 'GET, HEAD')
    return Response.json({ error: 'method_not_allowed', requestId: id }, { status: 405, headers })
  }

  const config = readServerConfig()
  return Response.json(
    {
      ok: true,
      service: 'chat-demo-api',
      environment: config.nodeEnv,
      requestId: id,
    },
    { status: 200, headers }
  )
}
