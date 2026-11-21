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

// eslint-disable-next-line import/no-default-export
export default async function me(request: Request): Promise<Response> {
  if (request.method !== 'GET') {
    return Response.json({ error: 'method_not_allowed' }, { status: 405, headers: { Allow: 'GET' } })
  }
  let session: SessionResult | null
  try {
    session = (await getSession(request.headers)) as SessionResult | null
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[api/me] session lookup failed', error instanceof Error ? error.message : 'unknown error')
    return Response.json({ error: 'service_unavailable' }, { status: 503 })
  }
  if (!session?.user?.id || !session.session?.expiresAt) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }
  return Response.json({
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
