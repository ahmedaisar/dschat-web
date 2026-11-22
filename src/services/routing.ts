import { useSyncExternalStore } from 'react'

export type AppRoute =
  | { kind: 'home' }
  | { kind: 'new' }
  | { kind: 'conversation'; id: string }
  | { kind: 'unknown'; pathname: string }

const NEW_PATH = '/c/new'
const CONVERSATION_PREFIX = '/c/'
const listeners = new Set<() => void>()

const notify = () => listeners.forEach((listener) => listener())

const onPopState = () => notify()
let listening = false

const ensureListening = () => {
  if (listening || typeof window === 'undefined') {
    return
  }
  listening = true
  window.addEventListener('popstate', onPopState)
}

const currentPath = () => (typeof window === 'undefined' ? '/' : window.location.pathname)

export const parseRoute = (pathname: string): AppRoute => {
  const normalized = pathname.replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/'
  if (normalized === '/') {
    return { kind: 'home' }
  }
  if (normalized === NEW_PATH) {
    return { kind: 'new' }
  }
  if (normalized.startsWith(CONVERSATION_PREFIX)) {
    const id = normalized.slice(CONVERSATION_PREFIX.length)
    if (id && !id.includes('/')) {
      try {
        const decoded = decodeURIComponent(id)
        return decoded && !decoded.includes('/')
          ? { kind: 'conversation', id: decoded }
          : { kind: 'unknown', pathname }
      } catch {
        return { kind: 'unknown', pathname }
      }
    }
  }
  return { kind: 'unknown', pathname }
}

export const routePath = (route: Exclude<AppRoute, { kind: 'unknown' | 'home' }>) =>
  route.kind === 'new' ? NEW_PATH : `${CONVERSATION_PREFIX}${encodeURIComponent(route.id)}`

export const newConversationPath = () => NEW_PATH
export const conversationPath = (id: string) => routePath({ kind: 'conversation', id })

export const navigate = (path: string, replace = false) => {
  if (typeof window === 'undefined' || window.location.pathname === path) {
    return
  }
  window.history[replace ? 'replaceState' : 'pushState']({}, '', path)
  notify()
}

const subscribe = (listener: () => void) => {
  ensureListening()
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const getSnapshot = () => currentPath()

export const useAppRoute = (): AppRoute =>
  parseRoute(useSyncExternalStore(subscribe, getSnapshot, () => '/'))

export const getAppRoute = () => parseRoute(currentPath())

export const isConversationRoute = (route: AppRoute): route is { kind: 'conversation'; id: string } =>
  route.kind === 'conversation'
