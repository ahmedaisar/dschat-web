export type ServerConfig = {
  nodeEnv: string
  appOrigin: string | null
  databaseUrl: string | null
  authSecretConfigured: boolean
  emailConfigured: boolean
}

/**
 * Read server-only configuration without exposing values to the browser.
 * Liveness endpoints may run without a database/auth configuration; protected
 * routes must call requireCoreConfig before doing authenticated work. Email
 * delivery is validated at the point where a verification or reset message is sent.
 */
export const readServerConfig = (): ServerConfig => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  appOrigin: process.env.APP_ORIGIN?.trim() || null,
  databaseUrl: process.env.DATABASE_URL?.trim() || null,
  authSecretConfigured: Boolean(process.env.AUTH_SECRET?.trim()),
  emailConfigured: Boolean(process.env.RESEND_API_KEY?.trim() && process.env.EMAIL_FROM?.trim()),
})

const validateOrigin = (appOrigin: string | null): void => {
  if (!appOrigin) {
    return
  }
  let origin: URL
  try {
    origin = new URL(appOrigin)
  } catch {
    throw new Error('APP_ORIGIN must be an absolute HTTP(S) origin')
  }
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.pathname !== '/') {
    throw new Error('APP_ORIGIN must be an absolute HTTP(S) origin without credentials or a path')
  }
}

export const requireCoreConfig = (): ServerConfig => {
  const config = readServerConfig()
  const missing: string[] = []
  const secret = process.env.AUTH_SECRET?.trim() ?? ''
  if (!config.databaseUrl) {
    missing.push('DATABASE_URL')
  }
  if (!config.authSecretConfigured || secret.length < 32) {
    missing.push('AUTH_SECRET (minimum 32 characters)')
  }
  if (!config.appOrigin) {
    missing.push('APP_ORIGIN')
  }
  validateOrigin(config.appOrigin)
  if (missing.length > 0) {
    throw new Error(`Missing server configuration: ${missing.join(', ')}`)
  }
  return config
}

export const requireProductionConfig = (): ServerConfig => {
  const config = requireCoreConfig()
  if (!config.emailConfigured) {
    throw new Error('Missing server configuration: RESEND_API_KEY and EMAIL_FROM')
  }
  return config
}
