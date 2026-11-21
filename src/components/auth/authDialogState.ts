import { create } from 'zustand'
import type { AuthDialogMode } from './AuthDialog.js'

type AuthDialogState = {
  mode: AuthDialogMode | null
  open: (mode?: AuthDialogMode) => void
  close: () => void
  setMode: (mode: AuthDialogMode) => void
}

export const useAuthDialog = create<AuthDialogState>((set) => ({
  mode: null,
  open: (mode = 'signIn') => set({ mode }),
  close: () => set({ mode: null }),
  setMode: (mode) => set({ mode }),
}))

export const openAuth = (mode: AuthDialogMode = 'signIn'): void => {
  useAuthDialog.getState().open(mode)
}

export const closeAuth = (): void => {
  useAuthDialog.getState().close()
}
