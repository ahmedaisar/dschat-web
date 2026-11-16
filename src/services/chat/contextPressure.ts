/**
 * 上下文压力模型，参考 DSH 的 compaction 预留与 dsh-context 的上下文分析：
 * - 自动压缩阈值：窗口的 80%，但不能吃掉「输出预留 + 64k 压缩余量」；
 * - 圆环与统计弹窗用同一套阈值，压缩后按摘要节省量折算占用。
 *
 * 对应上游实现：`packages/compaction/compaction-basic/src/config.ts`（0.8 / 65536）。
 */

export const COMPACT_THRESHOLD_RATIO = 0.8

/** 压缩预留余量：与 dsh-context 的 COMPACT_HEADROOM_TOKENS 一致 */
export const COMPACT_HEADROOM_TOKENS = 65_536

export type ContextReserve = {
  window: number
  /** 为本轮输出预留的 token */
  output: number
  /** 压缩余量 */
  headroom: number
  /** 自动压缩触发阈值 */
  threshold: number
}

/**
 * 计算窗口里给输出与压缩留出的空间，以及压力阈值。
 * 窗口小于输出预留 + 余量时返回 undefined（不做自动压缩）。
 */
export const reserveGeometry = (
  window: number,
  maxOutputTokens: number
): ContextReserve | undefined => {
  if (!Number.isFinite(window) || window <= 0) {
    return undefined
  }
  const output = Math.min(
    Math.max(0, Number.isFinite(maxOutputTokens) ? maxOutputTokens : 0),
    window
  )
  const pressureBudget = window - output - COMPACT_HEADROOM_TOKENS
  if (pressureBudget <= 0) {
    return undefined
  }
  const threshold = Math.min(Math.floor(window * COMPACT_THRESHOLD_RATIO), pressureBudget)
  return { window, output, headroom: COMPACT_HEADROOM_TOKENS, threshold }
}

/** 占用百分比，保留一位小数（与 dsh-context 一致） */
export const pressurePercent = (tokens: number, window: number): number => {
  if (!Number.isFinite(tokens) || !Number.isFinite(window) || window <= 0) {
    return 0
  }
  return Math.min(100, Math.round((tokens / window) * 1000) / 10)
}

/**
 * 压缩后的等效占用：摘要写入后，下一次请求会比上一次小 savedTokens；
 * 只有压缩发生在最近一次请求之后才折算，否则以服务端最新用量为准。
 */
export const effectiveContextTokens = (
  usageTokens: number,
  usageAt: number,
  compression: { at: number; savedTokens?: number } | undefined
): number => {
  if (!compression || compression.at <= usageAt) {
    return usageTokens
  }
  return Math.max(0, usageTokens - (compression.savedTokens ?? 0))
}
