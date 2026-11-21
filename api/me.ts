import type { IncomingMessage, ServerResponse } from 'node:http'
import { getSession } from './_lib/auth.js'

type SessionResult = {
  session?: {
    id?: string
    expiresAt?: Date | string
  }
  user?: {
    id?: string
    name?: string
    email?: string
    emailVerified?: boolean
    image?: string | null
  }
}

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
export default async function me(
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET')
    writeJson(response, 405, { error: 'method_not_allowed' })
    return
  }
  let session: SessionResult | null
  try {
    session = (await getSession(requestHeaders(request))) as SessionResult | null
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[api/me] session lookup failed', error instanceof Error ? error.message : 'unknown error')
    writeJson(response, 503, { error: 'service_unavailable' })
    return
  }
  if (!session?.user?.id || !session.session?.expiresAt) {
    writeJson(response, 401, { error: 'unauthorized' })
    return
  }
  writeJson(response, 200, {
    user: {
      id: session.user.id,
      name: session.user.name ?? null,
      email: session.user.email ?? null,
      emailVerified: session.user.emailVerified ?? false,
      image: session.user.image ?? null,
    },
    session: {
      id: session.session.id ?? null,
      expiresAt: session.session.expiresAt,
    },
  })
}
