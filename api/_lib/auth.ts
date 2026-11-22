import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { getDb } from './db.js'
import { requireCoreConfig } from './config.js'
import { account, session, user, userProfile, verification } from '../db/schema.js'

type AuthInstance = {
  handler: (request: Request) => Promise<Response>
  api: {
    getSession: (options: { headers: Headers }) => Promise<unknown>
  }
}

type AuthFactory = (options: Record<string, unknown>) => AuthInstance
type AuthModule = { betterAuth: AuthFactory }
type AuthUser = { email: string; name: string }

type AuthEmail = {
  user: AuthUser
  url: string
}

const sendAuthEmail = async (subject: string, email: AuthEmail): Promise<void> => {
  const apiKey = process.env.RESEND_API_KEY?.trim()
  const from = process.env.EMAIL_FROM?.trim()
  if (!apiKey || !from) {
    throw new Error('RESEND_API_KEY and EMAIL_FROM are required for auth email delivery')
  }
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [email.user.email],
      subject,
      text: `Continue with Chat Demo: ${email.url}`,
    }),
  })
  const responseBody = await response.text()
  if (!response.ok) {
    let providerMessage = responseBody.slice(0, 240).replace(/[\r\n]+/g, ' ')
    try {
      const payload = JSON.parse(responseBody) as { message?: string; name?: string }
      providerMessage = payload.message ?? payload.name ?? providerMessage
    } catch {
      // Keep the bounded raw provider response for diagnostics.
    }
    throw new Error(`Auth email delivery failed with status ${response.status}: ${providerMessage}`)
  }
  // eslint-disable-next-line no-console
  console.info('[api/auth] verification/reset email accepted by Resend', {
    status: response.status,
    fromDomain: from.split('@')[1] ?? 'invalid',
  })
}

let instance: AuthInstance | null = null

export const getAuth = async (): Promise<AuthInstance> => {
  if (instance) {
    return instance
  }
  const config = requireCoreConfig()
  const secret = process.env.AUTH_SECRET?.trim()
  if (!secret) {
    throw new Error('AUTH_SECRET is not configured')
  }
  const authModule = (await import('better-auth')) as unknown as AuthModule
  instance = authModule.betterAuth({
    database: drizzleAdapter(getDb(), {
      provider: 'pg',
      schema: { user, session, account, verification },
      transaction: true,
    }),
    secret,
    baseURL: config.appOrigin ?? undefined,
    trustedOrigins: config.appOrigin ? [config.appOrigin] : undefined,
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      sendResetPassword: async (email: AuthEmail) =>
        sendAuthEmail('Reset your Chat Demo password', email),
    },
    emailVerification: {
      sendVerificationEmail: async (email: AuthEmail) =>
        sendAuthEmail('Verify your Chat Demo email', email),
      sendOnSignUp: true,
      autoSignInAfterVerification: false,
    },
    databaseHooks: {
      user: {
        create: {
          after: async (user: { id: string }) => {
            const now = new Date()
            await getDb()
              .insert(userProfile)
              .values({
                userId: user.id,
                role: 'user',
                createdAt: now,
                updatedAt: now,
              })
              .onConflictDoNothing({ target: userProfile.userId })
          },
        },
      },
    },
    advanced: {
      useSecureCookies: config.nodeEnv === 'production',
    },
  })
  return instance
}

export const getSession = async (headers: Headers): Promise<unknown> =>
  (await getAuth()).api.getSession({ headers })
