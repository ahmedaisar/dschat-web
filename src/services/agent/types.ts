import type { ToolArtifact } from './tools.js'

/**
 * 一次客户端工具调用的展示记录。
 *
 * 保存的是「模型要调用什么 + 本地执行结果」，随回复一起写入 IndexedDB，
 * 刷新后仍能看到当时的工具卡片；导出的历史包不含这个字段，重新导入后不显示。
 */
export type ToolCallStatus = 'running' | 'done' | 'error' | 'rejected'

export type ChatToolCall = {
  /** tool_use 的 id，回传 tool_result 时用它对应 */
  id: string
  name: string
  /** 展示名，来自工具注册表；未知工具回落到 name */
  label: string
  input: unknown
  status: ToolCallStatus
  /** 执行中的进度文案 */
  detail?: string
  /** 结果的文本形式，用于卡片预览与回传模型 */
  content?: string
  startedAt: number
  endedAt?: number
  artifacts?: ToolArtifact[]
}

/** 参数摘要：卡片头部一行展示，过长时截断 */
export const summarizeToolInput = (call: ChatToolCall): string => {
  const input = call.input
  if (typeof input !== 'object' || input === null) {
    return String(input ?? '')
  }
  const entries = Object.entries(input as Record<string, unknown>).filter(
    ([, value]) => value !== undefined && value !== null && value !== ''
  )
  if (entries.length === 0) {
    return call.label
  }
  const text = entries
    .map(([key, value]) => {
      const rendered =
        typeof value === 'string'
          ? value.length > 60
            ? `${value.slice(0, 60)}…`
            : value
          : JSON.stringify(value)
      return `${key}=${rendered}`
    })
    .join(', ')
  return text.length > 160 ? `${text.slice(0, 160)}…` : text
}

/** 耗时：1 秒内按毫秒，其余按一位小数秒 */
export const toolDuration = (call: ChatToolCall): string | null => {
  if (call.endedAt === undefined) {
    return null
  }
  const ms = Math.max(0, call.endedAt - call.startedAt)
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`
}
