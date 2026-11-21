import { getPool } from './db.js'
import { requireProductionConfig } from './config.js'

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
  if (!response.ok) {
    throw new Error(`Auth email delivery failed with status ${response.status}`)
  }
}

let instance: AuthInstance | null = null

export const getAuth = async (): Promise<AuthInstance> => {
  if (instance) {
    return instance
  }
  const config = requireProductionConfig()
  const secret = process.env.AUTH_SECRET?.trim()
  if (!secret) {
    throw new Error('AUTH_SECRET is not configured')
  }
  const authModule = (await import('better-auth/minimal')) as unknown as AuthModule
  instance = authModule.betterAuth({
    database: getPool(),
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
            await getPool().query(
              'INSERT INTO "user_profile" ("user_id", "role", "created_at", "updated_at") VALUES ($1, \'user\', $2, $2) ON CONFLICT ("user_id") DO NOTHING',
              [user.id, now]
            )
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
