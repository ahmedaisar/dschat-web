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

type AuthState = {
  status: AuthStatus
  user: AuthUser | null
  sessionExpiresAt: string | null
  error: string | null
  refresh: () => Promise<void>
  signIn: (email: string, password: string) => Promise<void>
  signUp: (name: string, email: string, password: string) => Promise<void>
  requestPasswordReset: (email: string) => Promise<void>
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
    try {
      const payload = (await response.json()) as { message?: string; error?: string }
      message = payload.message ?? payload.error ?? message
    } catch {
      // Keep the status-based message when the server response is not JSON.
    }
    throw new Error(message)
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
      await authRequest('sign-in/email', { email, password })
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
      await authRequest('sign-up/email', { name, email, password })
      set({ status: 'anonymous', error: null })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Sign-up failed'
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
