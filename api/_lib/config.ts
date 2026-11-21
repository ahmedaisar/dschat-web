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
 * routes must call requireProductionConfig before doing work.
 */
export const readServerConfig = (): ServerConfig => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  appOrigin: process.env.APP_ORIGIN?.trim() || null,
  databaseUrl: process.env.DATABASE_URL?.trim() || null,
  authSecretConfigured: Boolean(process.env.AUTH_SECRET?.trim()),
  emailConfigured: Boolean(process.env.RESEND_API_KEY?.trim() && process.env.EMAIL_FROM?.trim()),
})

export const requireProductionConfig = (): ServerConfig => {
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
  if (!config.emailConfigured) {
    missing.push('RESEND_API_KEY and EMAIL_FROM')
  }
  if (config.appOrigin) {
    let origin: URL
    try {
      origin = new URL(config.appOrigin)
    } catch {
      throw new Error('APP_ORIGIN must be an absolute HTTP(S) origin')
    }
    if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.pathname !== '/') {
      throw new Error('APP_ORIGIN must be an absolute HTTP(S) origin without credentials or a path')
    }
  }
  if (missing.length > 0) {
    throw new Error(`Missing server configuration: ${missing.join(', ')}`)
  }
  return config
}
