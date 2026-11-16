import { streamMessage } from '../api/client.js'
import type { Locale } from '../settings.js'
import { getVisibleMessages } from './branches.js'
import { getReplyAnswerText } from './reply.js'
import type { Session, SessionCompression } from './types.js'

/**
 * 长对话压缩：把较早的轮次交给模型总结成摘要，摘要进入后续请求的上下文，
 * 本地完整历史仍然保留（只在请求里跳过被摘要覆盖的部分）。
 *
 * 手动压缩由统计弹窗触发；自动压缩在回复结束后按轮数阈值触发。
 */

/** 至少要有 3 轮可压缩内容 */
const MIN_ROUNDS = 3
/** 压缩时始终保留最近 2 轮原文 */
const KEEP_ROUNDS = 2
/** 自动压缩的触发轮数 */
export const AUTO_MIN_ROUNDS = 10
/** 上次压缩后新增多少轮再触发一次自动压缩 */
const AUTO_MIN_NEW_ROUNDS = 4
/** 摘要请求的输入上限，避免一次塞入过长文本 */
const MAX_TRANSCRIPT_CHARS = 48_000

const running = new Set<string>()

export const isCompressing = (sessionId: string) => running.has(sessionId)

export type CompressOutcome =
  | { ok: true; compression: SessionCompression }
  | { ok: false; reason: 'tooShort' | 'busy' | 'noKey' | 'error' }

const roundCount = (session: Session): number =>
  getVisibleMessages(session).filter((message) => message.role === 'user').length

/** 自动压缩判断：轮数够多，且距上次压缩已经积累了足够的新轮次 */
export const autoCompressNeeded = (session: Session): boolean => {
  if (roundCount(session) < AUTO_MIN_ROUNDS) {
    return false
  }
  const compression = session.compression
  if (!compression) {
    return true
  }
  const visible = getVisibleMessages(session)
  const cutoff = visible.findIndex((message) => message.id === compression.upToMessageId)
  if (cutoff < 0) {
    return true
  }
  const newRounds = visible.slice(cutoff + 1).filter((message) => message.role === 'user').length
  return newRounds >= AUTO_MIN_NEW_ROUNDS
}

const messageText = (message: ReturnType<typeof getVisibleMessages>[number]): string =>
  message.role === 'user' ? message.content : getReplyAnswerText(message)

/** 把要压缩的消息拼成带角色的纯文本，单条过长时截断 */
const buildTranscript = (
  messages: ReturnType<typeof getVisibleMessages>,
  locale: Locale
): string => {
  const userLabel = locale === 'zh-CN' ? '用户' : 'User'
  const assistantLabel = locale === 'zh-CN' ? '助手' : 'Assistant'
  const lines: string[] = []
  let total = 0
  for (const message of messages) {
    if (message.role !== 'user' && message.role !== 'assistant') {
      continue
    }
    const text = messageText(message).trim()
    if (text === '') {
      continue
    }
    const clipped = text.length > 4000 ? `${text.slice(0, 4000)}…` : text
    const line = `${message.role === 'user' ? userLabel : assistantLabel}: ${clipped}`
    if (total + line.length > MAX_TRANSCRIPT_CHARS) {
      break
    }
    lines.push(line)
    total += line.length + 1
  }
  return lines.join('\n\n')
}

const summarize = async (
  apiKey: string,
  transcript: string,
  locale: Locale,
  signal: AbortSignal
): Promise<string> => {
  const system =
    locale === 'zh-CN'
      ? '你是对话压缩器。把用户给出的对话记录压缩成要点摘要：保留用户的目标、偏好与约束，已确认的事实与结论，未完成的事项与下一步；用第三人称中文分条列出，不要编造，不要评论，只输出摘要正文。'
      : 'You compress conversations. Summarise the supplied transcript into bullet points: keep the user goals, preferences and constraints, confirmed facts and conclusions, open items and next steps. Use third person, do not invent, do not comment; output only the summary body.'
  const body = {
    model: 'deepseek-flash' as const,
    system,
    messages: [{ role: 'user' as const, content: transcript }],
    thinking: { type: 'disabled' as const },
    temperature: 0.3,
    max_tokens: 1200,
    tools: [],
  }
  let text = ''
  for await (const event of streamMessage(apiKey, body, signal)) {
    if (event.type === 'content_block_start' && event.content_block.type === 'text') {
      text += event.content_block.text
    } else if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      text += event.delta.text
    }
  }
  return text.trim()
}

/**
 * 压缩一个会话的较早轮次。返回新的压缩记录，调用方负责写回会话并提示。
 * 已压缩过的会话再次压缩时，会把上一次的摘要一并作为输入，避免丢信息。
 */
export const compressSession = async (
  session: Session,
  apiKey: string,
  locale: Locale
): Promise<CompressOutcome> => {
  if (!apiKey) {
    return { ok: false, reason: 'noKey' }
  }
  if (running.has(session.id)) {
    return { ok: false, reason: 'busy' }
  }
  const visible = getVisibleMessages(session)
  const userIndexes = visible
    .map((message, index) => (message.role === 'user' ? index : -1))
    .filter((index) => index >= 0)
  if (userIndexes.length < MIN_ROUNDS + KEEP_ROUNDS) {
    return { ok: false, reason: 'tooShort' }
  }
  const cutoffRound = userIndexes.length - KEEP_ROUNDS
  const cutoffIndex = userIndexes[cutoffRound] - 1
  if (cutoffIndex < 0) {
    return { ok: false, reason: 'tooShort' }
  }
  const target = visible.slice(0, cutoffIndex + 1)
  const transcript = buildTranscript(target, locale)
  if (transcript === '') {
    return { ok: false, reason: 'tooShort' }
  }
  running.add(session.id)
  const controller = new AbortController()
  try {
    const previous = session.compression
    const header =
      previous && locale === 'zh-CN'
        ? `上一次的摘要：\n${previous.summary}\n\n新增对话：\n`
        : previous
          ? `Previous summary:\n${previous.summary}\n\nNew transcript:\n`
          : ''
    const summary = await summarize(apiKey, `${header}${transcript}`, locale, controller.signal)
    if (summary === '') {
      return { ok: false, reason: 'error' }
    }
    return {
      ok: true,
      compression: {
        summary,
        upToMessageId: visible[cutoffIndex].id,
        rounds: cutoffRound,
        at: Date.now(),
      },
    }
  } catch {
    return { ok: false, reason: 'error' }
  } finally {
    running.delete(session.id)
  }
}
