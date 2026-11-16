/**
 * 实验台三类导出文件的格式判定：多路赛跑、变体赛跑、EasyJailbreak 实验。
 * 三者都有 `results` 数组，单靠数组无法区分，所以用 `type` 与 `calls` 特征做严格校验，
 * 防止把一个页面的结果误导入到另一个页面。
 */

export type LabJsonRecord = Record<string, unknown>

const asRecord = (value: unknown): LabJsonRecord | null =>
  typeof value === 'object' && value !== null ? (value as LabJsonRecord) : null

export type RaceFileData = {
  query: string
  results: LabJsonRecord[]
}

/** 多路赛跑导出的 JSON（`type: "race"`） */
export const readRaceFile = (value: unknown): RaceFileData | null => {
  const record = asRecord(value)
  if (!record || record.type !== 'race' || !Array.isArray(record.results)) {
    return null
  }
  return {
    query: typeof record.query === 'string' ? record.query : '',
    results: record.results as LabJsonRecord[],
  }
}

export type VariantFileData = {
  query: string
  tier: 'light' | 'standard' | 'heavy' | null
  model: 'deepseek-flash' | 'deepseek-v4-pro' | null
  system: string
  results: LabJsonRecord[]
}

/** 变体赛跑导出的 JSON（`type: "variant-race"`） */
export const readVariantFile = (value: unknown): VariantFileData | null => {
  const record = asRecord(value)
  if (!record || record.type !== 'variant-race' || !Array.isArray(record.results)) {
    return null
  }
  const tier =
    record.tier === 'light' || record.tier === 'standard' || record.tier === 'heavy'
      ? record.tier
      : null
  const model =
    record.model === 'deepseek-flash' || record.model === 'deepseek-v4-pro' ? record.model : null
  return {
    query: typeof record.query === 'string' ? record.query : '',
    tier,
    model,
    system: typeof record.system === 'string' ? record.system : '',
    results: record.results as LabJsonRecord[],
  }
}

export type AttackFileData = { job: LabJsonRecord }

/**
 * EasyJailbreak 实验导出（`{ job: {...} }`，或旧版的裸 job）。
 * 特征：带 `calls` 与 `results`；赛跑/变体文件没有 `calls`。
 */
export const readAttackFile = (value: unknown): AttackFileData | null => {
  const record = asRecord(value)
  if (!record) {
    return null
  }
  const job = asRecord(record.job) ?? record
  if (!Array.isArray(job.results) || !asRecord(job.calls)) {
    return null
  }
  return { job }
}
