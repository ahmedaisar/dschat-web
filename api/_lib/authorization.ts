import { getPool } from './db.js'
import { getSession } from './auth.js'

export type CurrentUser = {
  id: string
  name: string
  email: string
  emailVerified: boolean
  image: string | null
  role: 'user' | 'admin'
  displayName: string | null
}

export class AuthorizationError extends Error {
  readonly status: 401 | 403 | 503

  constructor(status: 401 | 403 | 503, message: string) {
    super(message)
    this.name = 'AuthorizationError'
    this.status = status
  }
}

type SessionResult = {
  session?: { expiresAt?: Date | string }
  user?: {
    id?: string
    name?: string
    email?: string
    emailVerified?: boolean
    image?: string | null
  }
}

const toHeaders = (headers: HeadersInit): Headers => new Headers(headers)

export const requireUser = async (headers: HeadersInit): Promise<CurrentUser> => {
  let session: SessionResult | null
  try {
    session = (await getSession(toHeaders(headers))) as SessionResult | null
  } catch {
    throw new AuthorizationError(503, 'Authentication service unavailable')
  }
  const user = session?.user
  const expiresAt = session?.session?.expiresAt
  if (!user?.id || !user.email || !expiresAt) {
    throw new AuthorizationError(401, 'Authentication required')
  }

  try {
    const result = await getPool().query<{
      role: 'user' | 'admin'
      display_name: string | null
    }>(
      'SELECT "role", "display_name" FROM "user_profile" WHERE "user_id" = $1',
      [user.id]
    )
    const profile = result.rows[0]
    if (!profile) {
      throw new AuthorizationError(403, 'User profile is unavailable')
    }
    return {
      id: user.id,
      name: user.name ?? '',
      email: user.email,
      emailVerified: user.emailVerified ?? false,
      image: user.image ?? null,
      role: profile.role,
      displayName: profile.display_name,
    }
  } catch (error) {
    if (error instanceof AuthorizationError) {
      throw error
    }
    throw new AuthorizationError(503, 'User profile service unavailable')
  }
}

export const requireAdmin = async (headers: HeadersInit): Promise<CurrentUser> => {
  const user = await requireUser(headers)
  if (user.role !== 'admin') {
    throw new AuthorizationError(403, 'Administrator access required')
  }
  return user
}
