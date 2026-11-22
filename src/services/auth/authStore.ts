import { create } from 'zustand'

export type AuthUser = {
  id: string
  name: string | null
  email: string | null
  emailVerified: boolean
  image: string | null
}

type SessionResponse = {
  user: AuthUser
  session: { id: string | null; expiresAt: string | Date }
}

type AuthStatus = 'idle' | 'loading' | 'authenticated' | 'anonymous' | 'error'

export class AuthApiError extends Error {
  readonly status: number
  readonly code: string | null

  constructor(status: number, code: string | null, message: string) {
    super(message)
    this.name = 'AuthApiError'
    this.status = status
    this.code = code
  }
}

type AuthState = {
  status: AuthStatus
  user: AuthUser | null
  sessionExpiresAt: string | null
  error: string | null
  refresh: () => Promise<void>
  signIn: (email: string, password: string) => Promise<void>
  signUp: (name: string, email: string, password: string) => Promise<void>
  requestPasswordReset: (email: string) => Promise<void>
  resendVerification: (email: string) => Promise<void>
  resetPassword: (token: string, password: string) => Promise<void>
  signOut: () => Promise<void>
}

const authRequest = async (path: string, body?: Record<string, string>): Promise<void> => {
  const response = await fetch(`/api/auth/${path}`, {
    method: body ? 'POST' : 'GET',
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!response.ok) {
    let message = `Request failed (${response.status})`
    let code: string | null = null
    try {
      const payload = (await response.json()) as { message?: string; error?: string; code?: string }
      message = payload.message ?? payload.error ?? message
      code = payload.code ?? null
    } catch {
      // Keep the status-based message when the server response is not JSON.
    }
    throw new AuthApiError(response.status, code, message)
  }
}

export const useAuthStore = create<AuthState>((set) => ({
  status: 'idle',
  user: null,
  sessionExpiresAt: null,
  error: null,
  refresh: async () => {
    set({ status: 'loading', error: null })
    try {
      const response = await fetch('/api/me', { credentials: 'same-origin' })
      if (response.status === 401) {
        set({ status: 'anonymous', user: null, sessionExpiresAt: null, error: null })
        return
      }
      if (!response.ok) {
        throw new Error(`Session request failed (${response.status})`)
      }
      const payload = (await response.json()) as SessionResponse
      set({
        status: 'authenticated',
        user: payload.user,
        sessionExpiresAt: String(payload.session.expiresAt),
        error: null,
      })
    } catch (error) {
      set({
        status: 'error',
        user: null,
        sessionExpiresAt: null,
        error: error instanceof Error ? error.message : 'Session request failed',
      })
    }
  },
  signIn: async (email, password) => {
    set({ status: 'loading', error: null })
    try {
      await authRequest('sign-in', { email, password })
      await useAuthStore.getState().refresh()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Sign-in failed'
      set({ status: 'anonymous', error: message })
      throw error
    }
  },
  signUp: async (name, email, password) => {
    set({ status: 'loading', error: null })
    try {
      await authRequest('sign-up', { name, email, password })
      set({ status: 'anonymous', error: null })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Sign-up failed'
      set({ status: 'anonymous', error: message })
      throw error
    }
  },
  resendVerification: async (email) => {
    set({ status: 'loading', error: null })
    try {
      await authRequest('send-verification-email', {
        email,
        callbackURL: window.location.origin,
      })
      set({ status: 'anonymous', error: null })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Verification email failed'
      set({ status: 'anonymous', error: message })
      throw error
    }
  },
  resetPassword: async (token, password) => {
    set({ status: 'loading', error: null })
    try {
      await authRequest('reset-password', { token, newPassword: password })
      set({ status: 'anonymous', error: null })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Password reset failed'
      set({ status: 'anonymous', error: message })
      throw error
    }
  },
  requestPasswordReset: async (email) => {
    set({ status: 'loading', error: null })
    try {
      await authRequest('forget-password', { email, redirectTo: window.location.origin })
      set({ status: 'anonymous', error: null })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Password reset failed'
      set({ status: 'anonymous', error: message })
      throw error
    }
  },
  signOut: async () => {
    set({ status: 'loading', error: null })
    try {
      await authRequest('sign-out', {})
      set({ status: 'anonymous', user: null, sessionExpiresAt: null, error: null })
    } catch (error) {
      set({ status: 'error', error: error instanceof Error ? error.message : 'Sign-out failed' })
      throw error
    }
  },
}))
