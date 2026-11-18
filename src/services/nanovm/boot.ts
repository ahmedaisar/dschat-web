import { create } from 'zustand'
import type { EngineInfo, ShellEngine } from './types.js'

/**
 * WASM Shell Engine 的懒加载入口。
 *
 * 首屏只加载这个文件（几 KB）。真正的引擎、解析器与 busybox 应用集都在
 * `engine.js` 这个异步 chunk 里，第一次执行命令或用户点开终端时才下载并实例化。
 * 引擎创建失败时把错误留在 status 里，UI 显示「重试」而不是让整个页面崩掉。
 */

export type EngineStatus = 'idle' | 'loading' | 'ready' | 'error'

type EngineState = {
  status: EngineStatus
  info: EngineInfo | null
  error: string | null
}

export const useEngine = create<EngineState>(() => ({ status: 'idle', info: null, error: null }))

let instance: ShellEngine | null = null
let pending: Promise<ShellEngine | null> | null = null

/** 已加载的引擎实例，没有则为 null */
export const engineInstance = (): ShellEngine | null => instance

/** 把运行时错误转成一行可读文案 */
const describe = (error: unknown): string =>
  error instanceof Error ? error.message : typeof error === 'string' ? error : '未知错误'

/**
 * 加载引擎：并发调用共享同一个 Promise，失败后允许重试。
 * 内存配额变了要重新分配线性内存，调用方先 resetEngine()。
 */
export const loadEngine = async (): Promise<ShellEngine | null> => {
  if (instance) {
    return instance
  }
  if (pending) {
    return pending
  }
  useEngine.setState({ status: 'loading', error: null })
  pending = (async () => {
    try {
      // 动态 import：rspack 把它切成独立 chunk，首屏不下载
      const { createEngine } = await import('./engine.js')
      const engine = await createEngine()
      instance = engine
      useEngine.setState({ status: 'ready', info: engine.info, error: null })
      return engine
    } catch (error) {
      useEngine.setState({ status: 'error', error: describe(error), info: null })
      return null
    } finally {
      pending = null
    }
  })()
  return pending
}

/** 释放引擎（改内存配额、重置虚拟机后调用），下次执行重新实例化 */
export const resetEngine = () => {
  instance = null
  pending = null
  useEngine.setState({ status: 'idle', info: null, error: null })
}
