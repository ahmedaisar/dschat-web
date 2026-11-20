export type ChatGPTSessionStatus = {
  connected: boolean
  expiresAt?: number
  scope?: string
}

export const getChatGPTSession = async (): Promise<ChatGPTSessionStatus> => {
  const response = await fetch('/api/auth/chatgpt/session', { credentials: 'same-origin' })
  if (!response.ok) {
    return { connected: false }
  }
  return (await response.json()) as ChatGPTSessionStatus
}

export const startChatGPTLogin = () => {
  window.location.assign(`/api/auth/chatgpt/start?return_to=${encodeURIComponent(window.location.pathname || '/c/new')}`)
}

export const logoutChatGPT = async () => {
  await fetch('/api/auth/chatgpt/logout', { method: 'POST', credentials: 'same-origin' })
}

export const fetchChatGPTModels = async (): Promise<unknown> => {
  const response = await fetch('/api/chatgpt/models', { credentials: 'same-origin' })
  if (!response.ok) {
    throw new Error(`ChatGPT models failed (${response.status})`)
  }
  return response.json()
}
