import { create } from 'zustand'
import type { AutoTuneParams, ContextType } from '../unrestricted/autotune.js'
import {
  computeHeuristics,
  createInitialFeedbackState,
  processFeedback,
  type FeedbackState,
} from '../unrestricted/autotuneFeedback.js'

/**
 * 回复评分与 AutoTune 反馈环（移植自 G0DM0D3）。
 *
 * 点赞 / 点踩只记录评分并与该轮的上下文类型、采样参数一起写入 EMA 画像；
 * 同一问题再次点同一个按钮表示取消评分。没有 AutoTune 元数据的回复使用中性参数。
 */

const STATE_KEY = 'chat-demo:feedback-state'
const RATING_KEY = 'chat-demo:feedback-ratings'
const MAX_RATINGS = 1000

const NEUTRAL_PARAMS: AutoTuneParams = {
  temperature: 1,
  top_p: 1,
  top_k: 0,
  frequency_penalty: 0,
  presence_penalty: 0,
  repetition_penalty: 1,
}

type Ratings = Record<string, 1 | -1>
type TuneMeta = { contextType: ContextType; params: AutoTuneParams }

/** 生成时记录的调参元数据，只存在内存里；刷新后评分退回中性参数 */
const tuneMeta = new Map<string, TuneMeta>()

const readJson = <T>(key: string): T | null => {
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? null : (JSON.parse(raw) as T)
  } catch {
    return null
  }
}

const writeJson = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // 隐私模式下写不进去也不影响本次评分
  }
}

const loadState = (): FeedbackState => {
  const saved = readJson<FeedbackState>(STATE_KEY)
  return saved && Array.isArray(saved.history) && saved.learnedProfiles
    ? saved
    : createInitialFeedbackState()
}

const loadRatings = (): Ratings => readJson<Ratings>(RATING_KEY) ?? {}

export const useFeedback = create<{ state: FeedbackState; ratings: Ratings }>(() => ({
  state: loadState(),
  ratings: loadRatings(),
}))

/** 生成结束前记录本轮上下文类型与参数，评分时按它们更新画像 */
export const noteAutoTune = (
  messageId: string,
  contextType: ContextType,
  params: AutoTuneParams
) => {
  tuneMeta.set(messageId, { contextType, params })
  if (tuneMeta.size > MAX_RATINGS) {
    const oldest = tuneMeta.keys().next().value
    if (oldest !== undefined) {
      tuneMeta.delete(oldest)
    }
  }
}

/** 给一条回复评分；重复点击同一评分表示取消 */
export const rateReply = (messageId: string, text: string, rating: 1 | -1): boolean => {
  const current = useFeedback.getState()
  const previous = current.ratings[messageId]
  let ratings = { ...current.ratings }
  if (previous === rating) {
    ratings = Object.fromEntries(
      Object.entries(ratings).filter(([id]) => id !== messageId)
    ) as Ratings
    useFeedback.setState({ ratings })
    writeJson(RATING_KEY, ratings)
    return false
  }
  ratings[messageId] = rating
  const meta = tuneMeta.get(messageId)
  const nextState = processFeedback(current.state, {
    messageId,
    timestamp: Date.now(),
    contextType: meta?.contextType ?? 'conversational',
    model: 'deepseek-flash',
    persona: 'default',
    params: meta?.params ?? NEUTRAL_PARAMS,
    rating,
    heuristics: computeHeuristics(text),
  })
  useFeedback.setState({ state: nextState, ratings })
  writeJson(STATE_KEY, nextState)
  writeJson(RATING_KEY, ratings)
  return true
}

/** 评分统计：样本数、点赞率，供设置页或调试使用 */
export const feedbackSummary = (): { samples: number; positive: number; negative: number } => {
  const { state } = useFeedback.getState()
  let positive = 0
  let negative = 0
  for (const profile of Object.values(state.learnedProfiles)) {
    positive += profile.positiveCount
    negative += profile.negativeCount
  }
  return { samples: state.history.length, positive, negative }
}
