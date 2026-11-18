import { useSyncExternalStore } from 'react'
import {
  subscribeVmUsage,
  vmUsageSnapshot,
  type VmUsageSnapshot,
} from '../../services/nanovm/session.js'

/**
 * 虚拟机用量：文件数、字节数与配额。
 * 快照在 session.ts 里做过浅比较缓存，内容没变时引用不变，可以直接交给 useSyncExternalStore。
 */
export const useVmUsage = (): VmUsageSnapshot =>
  useSyncExternalStore(subscribeVmUsage, vmUsageSnapshot)

/** 字节数换算成 MB 文案：一两百 MB 时收成整数，少量文件保留两位小数 */
export const mbText = (bytes: number): string => {
  const value = bytes / (1024 * 1024)
  if (value >= 100) {
    return value.toFixed(0)
  }
  return value >= 10 ? value.toFixed(1) : value.toFixed(2)
}
