import { create } from 'zustand'
import { vmFs } from './fs.js'

/**
 * NanoVM Slim 的开关与资源配额。
 *
 * 和 API Key 一样只存本机 localStorage。改内存 / 磁盘会立刻同步给虚拟文件系统，
 * 引擎下一次启动（或 vm resize）时按新配额重建线性内存。
 */

const KEY = 'chat-demo:nanovm-config'

export type NanoVMConfig = {
  /** 总开关：关闭后侧栏入口与设置里的控制台都不可用，模型也看不到 shell 工具 */
  enabled: boolean
  /** 允许模型调用 shell（用户手动打开终端不受影响） */
  allowAgent: boolean
  /** 首次打开 / 首次调用时加载 WASM Shell Engine */
  autoLoad: boolean
  /** 桌面端右侧常驻停靠（关闭后点按钮才弹出） */
  desktopDock: boolean
  /** WASM 线性内存配额（MB） */
  memoryMB: number
  /** 虚拟磁盘配额（MB） */
  diskMB: number
  /** 单条命令超时（毫秒） */
  timeoutMs: number
}

export const MEMORY_MIN_MB = 32
export const MEMORY_MAX_MB = 2048
export const DISK_MIN_MB = 16
export const DISK_MAX_MB = 2048
export const TIMEOUT_MIN_MS = 1000
export const TIMEOUT_MAX_MS = 120_000

const defaults: NanoVMConfig = {
  enabled: true,
  allowAgent: false,
  autoLoad: true,
  desktopDock: true,
  memoryMB: 128,
  diskMB: 64,
  timeoutMs: 15_000,
}

const clamp = (value: number, min: number, max: number) =>
  Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : min

const read = (): NanoVMConfig => {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) {
      return { ...defaults }
    }
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) {
      return { ...defaults }
    }
    const source = parsed as Partial<NanoVMConfig>
    return {
      enabled: typeof source.enabled === 'boolean' ? source.enabled : defaults.enabled,
      allowAgent: typeof source.allowAgent === 'boolean' ? source.allowAgent : defaults.allowAgent,
      autoLoad: typeof source.autoLoad === 'boolean' ? source.autoLoad : defaults.autoLoad,
      desktopDock:
        typeof source.desktopDock === 'boolean' ? source.desktopDock : defaults.desktopDock,
      memoryMB: clamp(source.memoryMB ?? defaults.memoryMB, MEMORY_MIN_MB, MEMORY_MAX_MB),
      diskMB: clamp(source.diskMB ?? defaults.diskMB, DISK_MIN_MB, DISK_MAX_MB),
      timeoutMs: clamp(source.timeoutMs ?? defaults.timeoutMs, TIMEOUT_MIN_MS, TIMEOUT_MAX_MS),
    }
  } catch {
    return { ...defaults }
  }
}

/** 单文件上限跟着磁盘配额走：磁盘的一半，最多 256MB，最少 1MB */
export const fileLimitMB = (diskMB: number): number =>
  Math.max(1, Math.min(256, Math.floor(diskMB / 2)))

const syncLimits = (config: NanoVMConfig) => {
  vmFs.setLimits({ diskMB: config.diskMB, fileMB: fileLimitMB(config.diskMB), maxFiles: 20_000 })
}

const write = (config: NanoVMConfig) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(config))
  } catch {
    // 隐私模式写不进去也不影响本次会话
  }
}

export const useNanoVMConfig = create<NanoVMConfig>(() => {
  const config = read()
  syncLimits(config)
  return config
})

export const nanoVMConfig = (): NanoVMConfig => useNanoVMConfig.getState()

export const setNanoVMConfig = (patch: Partial<NanoVMConfig>) => {
  const next = { ...useNanoVMConfig.getState(), ...patch }
  next.memoryMB = clamp(next.memoryMB, MEMORY_MIN_MB, MEMORY_MAX_MB)
  next.diskMB = clamp(next.diskMB, DISK_MIN_MB, DISK_MAX_MB)
  next.timeoutMs = clamp(next.timeoutMs, TIMEOUT_MIN_MS, TIMEOUT_MAX_MS)
  write(next)
  syncLimits(next)
  useNanoVMConfig.setState(next)
}

export const setNanoVMEnabled = (enabled: boolean) => setNanoVMConfig({ enabled })
export const setNanoVMAllowAgent = (allowAgent: boolean) => setNanoVMConfig({ allowAgent })
/** 模型是否真的能调用：总开关 + 允许模型调用 */
export const nanoVMAgentAvailable = (): boolean => {
  const config = useNanoVMConfig.getState()
  return config.enabled && config.allowAgent
}

export const resetNanoVMConfig = () => {
  write({ ...defaults })
  syncLimits(defaults)
  useNanoVMConfig.setState({ ...defaults })
}
