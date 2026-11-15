import { create } from 'zustand'

/** 实验台入口状态；后端地址持久化，方便下次直接连接。 */
const ENDPOINT_KEY = 'chat-demo:lab-endpoint'
const DEFAULT_ENDPOINT = 'http://127.0.0.1:8765/mcp'

const readEndpoint = (): string => {
  try {
    return localStorage.getItem(ENDPOINT_KEY) || DEFAULT_ENDPOINT
  } catch {
    return DEFAULT_ENDPOINT
  }
}

export const useLab = create<{ open: boolean; endpoint: string }>(() => ({
  open: false,
  endpoint: readEndpoint(),
}))

export const openLab = () => useLab.setState({ open: true })
export const closeLab = () => useLab.setState({ open: false })

export const setLabEndpoint = (endpoint: string) => {
  try {
    localStorage.setItem(ENDPOINT_KEY, endpoint)
  } catch {
    // 存储不可用时只改内存
  }
  useLab.setState({ endpoint })
}
