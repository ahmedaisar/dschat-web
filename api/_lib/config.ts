export type ServerConfig = {
  nodeEnv: string
  appOrigin: string | null
  databaseUrl: string | null
  authSecretConfigured: boolean
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
})

export const requireProductionConfig = (): ServerConfig => {
  const config = readServerConfig()
  const missing: string[] = []
  if (!config.databaseUrl) {
    missing.push('DATABASE_URL')
  }
  if (!config.authSecretConfigured) {
    missing.push('AUTH_SECRET')
  }
  if (config.nodeEnv === 'production' && !config.appOrigin) {
    missing.push('APP_ORIGIN')
  }
  if (missing.length > 0) {
    throw new Error(`Missing server configuration: ${missing.join(', ')}`)
  }
  return config
}
