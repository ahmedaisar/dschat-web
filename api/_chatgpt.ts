import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export const ISSUER = 'https://auth.openai.com'
export const RESOURCE = 'https://api.openai.com/v1'
export const SCOPES = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct'
export const AUTHORIZATION_ENDPOINT = `${ISSUER}/api/accounts/authorize`
export const TOKEN_ENDPOINT = `${ISSUER}/api/accounts/oauth/token`
export const RESPONSES_ENDPOINT = `${RESOURCE}/responses`

export type ChatGPTSession = {
  accessToken: string
  refreshToken?: string
  expiresAt: number
  clientId: string
  scope: string
}

export type OAuthTransaction = { state: string; verifier: string; returnTo: string; clientId: string; redirectUri: string }

const secret = () => {
  const value = process.env.OPENAI_SIWC_SESSION_SECRET
  if (!value || value.length < 32) {
    throw new Error('OPENAI_SIWC_SESSION_SECRET must be at least 32 characters')
  }
  return createHash('sha256').update(value).digest()
}

const b64 = (value: Buffer) => value.toString('base64url')
const unb64 = (value: string) => Buffer.from(value, 'base64url')

export const seal = (value: unknown) => {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', secret() as any, iv as any)
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value)) as any, cipher.final() as any])
  return `${b64(iv)}.${b64(cipher.getAuthTag())}.${b64(encrypted)}`
}

export const unseal = <T>(value: string): T | null => {
  try {
    const [iv, tag, encrypted] = value.split('.')
    if (!iv || !tag || !encrypted) return null
    const decipher = createDecipheriv('aes-256-gcm', secret() as any, unb64(iv) as any)
    decipher.setAuthTag(unb64(tag) as any)
    return JSON.parse(Buffer.concat([decipher.update(unb64(encrypted) as any) as any, decipher.final() as any]).toString()) as T
  } catch {
    return null
  }
}

export const parseCookies = (header: string | undefined): Record<string, string> =>
  Object.fromEntries(
    (header ?? '').split(';').flatMap((part) => {
      const index = part.indexOf('=')
      if (index < 0) return []
      return [[part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())]]
    })
  )

export const cookie = (name: string, value: string, maxAge: number) =>
  `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax; Secure`

export const expiredCookie = (name: string) =>
  `${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure`

export const originFor = (req: { headers: Record<string, string | string[] | undefined> }) => {
  const forwardedProto = req.headers['x-forwarded-proto']
  const forwardedHost = req.headers['x-forwarded-host']
  const proto = typeof forwardedProto === 'string' ? forwardedProto.split(',')[0] : 'https'
  const host = typeof forwardedHost === 'string' ? forwardedHost.split(',')[0] : req.headers.host
  if (!host) throw new Error('Missing request host')
  return `${proto}://${host}`
}

export const json = (res: { setHeader: (name: string, value: string) => void; status: (code: number) => { json: (value: unknown) => void } }, status: number, value: unknown) => {
  res.setHeader('Cache-Control', 'no-store')
  res.status(status).json(value)
}

export const verifyState = (value: string, expectedState: string) => {
  const decoded = unseal<OAuthTransaction>(value)
  if (!decoded || decoded.state.length !== expectedState.length) return null
  const valid = timingSafeEqual(Buffer.from(decoded.state) as any, Buffer.from(expectedState) as any)
  return valid ? decoded : null
}

export const exchangeCode = async (params: URLSearchParams) => {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
    body: params,
  })
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>
  if (!response.ok) throw new Error(typeof body.error_description === 'string' ? body.error_description : `OAuth token exchange failed (${response.status})`)
  return body
}

export const refreshSession = async (session: ChatGPTSession): Promise<ChatGPTSession> => {
  if (!session.refreshToken) throw new Error('ChatGPT session expired; sign in again')
  const body = await exchangeCode(new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: session.clientId,
    refresh_token: session.refreshToken,
    resource: RESOURCE,
  }))
  if (typeof body.access_token !== 'string' || typeof body.expires_in !== 'number') {
    throw new Error('OpenAI returned an invalid refreshed session')
  }
  return {
    ...session,
    accessToken: body.access_token,
    expiresAt: Date.now() + body.expires_in * 1000,
    refreshToken: typeof body.refresh_token === 'string' ? body.refresh_token : session.refreshToken,
    scope: typeof body.scope === 'string' ? body.scope : session.scope,
  }
}

export const sessionFromRequest = async (req: { headers: Record<string, string | string[] | undefined> }) => {
  const cookies = parseCookies(typeof req.headers.cookie === 'string' ? req.headers.cookie : undefined)
  const current = cookies.chatgpt_session ? unseal<ChatGPTSession>(cookies.chatgpt_session) : null
  if (!current) return null
  if (current.expiresAt > Date.now() + 60_000) return { session: current, setCookie: undefined }
  const refreshed = await refreshSession(current)
  return { session: refreshed, setCookie: cookie('chatgpt_session', seal(refreshed), 60 * 60 * 24 * 30) }
}
