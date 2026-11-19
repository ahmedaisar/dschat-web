import { ApiError, request } from './transport.js'
import { readServerSentEvents } from './sse.js'
import { chatCompletionsUrl, modelsUrl } from './provider.js'
import { createId } from '../../utils/id.js'
import type {
  AssistantBlockParam,
  CreateMessageRequest,
  ClientToolDefinition,
  MessageParam,
  MessageStreamEvent,
  MessageUsage,
} from './types.js'
import type { CustomProvider } from '../settings.js'

/**
 * 自定义 OpenAI 兼容提供商（BYOK）的传输层：
 * - 把内部 Anthropic 消息协议翻译成 OpenAI Chat Completions 请求；
 * - 流式响应（SSE，[DONE] 结束）翻译回内部 MessageStreamEvent，供既有渲染路径消费；
 * - 服务端专有能力（deepseek_web_search / deepseek_read_url / safety_check / title）被丢弃，
 *   因为通用 OpenAI 兼容端点不实现它们。
 */

type OpenAIMessage =
  | { role: 'system' | 'user'; content: OpenAIContent }
  | { role: 'assistant'; content: string | null; tool_calls?: OpenAIToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string }

type OpenAIContent = string | OpenAIContentPart[]
type OpenAIContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

type OpenAIToolCall = {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

type OpenAIRequest = {
  model: string
  messages: OpenAIMessage[]
  stream: true
  stream_options: { include_usage: boolean }
  temperature?: number
  top_p?: number
  max_tokens?: number
  /** 推理模型的思考强度；仅在请求里带了 reasoning_effort 时下发 */
  reasoning_effort?: string
  tools?: Array<{
    type: 'function'
    function: { name: string; description: string; parameters: ClientToolDefinition['input_schema'] }
  }>
  tool_choice?: 'auto'
}

/** 把一个用户消息的 content（含附件块）翻译成 OpenAI content；文本型附件内联为文字 */
const userContent = (
  content: Extract<MessageParam, { role: 'user' }>['content']
): OpenAIContent => {
  if (typeof content === 'string') {
    return content
  }
  // 纯 tool_result 数组在外层拆成独立的 tool 消息，这里不应出现
  const textParts: string[] = []
  const imageParts: OpenAIContentPart[] = []
  for (const block of content) {
    if (block.type === 'tool_result') {
      // 混合数组（tool_result 与其他块混排）不属于本协议的正常用法，跳过
      continue
    }
    if (block.type === 'text' && !('source' in block)) {
      textParts.push(block.text)
      continue
    }
    if ('source' in block && block.source.type === 'base64') {
      imageParts.push({
        type: 'image_url',
        image_url: { url: `data:${block.source.media_type};base64,${block.source.data}` },
      })
      continue
    }
    if ('source' in block && block.source.type === 'text') {
      textParts.push(`[附件：${block.source.name}]\n${block.source.data}`)
      continue
    }
    // Files API 的 file_id 引用仅在 DeepSeek 上有意义，自定义端点跳过
  }
  const text = textParts.join('\n\n')
  // 只有文字时用纯字符串；含图片时用 parts 数组（OpenAI 视觉消息格式）
  if (imageParts.length === 0) {
    return text
  }
  return [...(text ? [{ type: 'text' as const, text }] : []), ...imageParts]
}

/** assistant 历史消息：正文拼接；工具调用块转成 tool_calls；思考与服务端工具块丢弃 */
const assistantMessage = (
  content: AssistantBlockParam[]
): Extract<OpenAIMessage, { role: 'assistant' }> | null => {
  const texts: string[] = []
  const toolCalls: OpenAIToolCall[] = []
  for (const block of content) {
    switch (block.type) {
      case 'text':
        if (block.text.trim() !== '') {
          texts.push(block.text)
        }
        break
      case 'tool_use':
        toolCalls.push({
          id: block.id,
          type: 'function',
          function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) },
        })
        break
      default:
        // thinking / signature / server tools：通用 OpenAI 端点没有这些概念，丢弃
        break
    }
  }
  if (texts.length === 0 && toolCalls.length === 0) {
    return null
  }
  return {
    role: 'assistant',
    content: texts.join('\n\n') || null,
    ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
  }
}

const toOpenAIMessages = (body: CreateMessageRequest): OpenAIMessage[] => {
  const messages: OpenAIMessage[] = []
  if (body.system.trim() !== '') {
    messages.push({ role: 'system', content: body.system })
  }
  for (const message of body.messages) {
    if (message.role === 'latest_reminder') {
      // Chat Engine 的注入角色，OpenAI 没有对应物；降级为 system 消息保持位置语义
      messages.push({ role: 'system', content: message.content })
      continue
    }
    if (message.role === 'assistant') {
      const assistant = assistantMessage(message.content)
      if (assistant) {
        messages.push(assistant)
      }
      continue
    }
    // user：可能是 tool_result 数组，需要拆成 tool 角色消息
    const content = message.content
    if (Array.isArray(content) && content.every((block) => block.type === 'tool_result')) {
      for (const block of content) {
        messages.push({ role: 'tool', tool_call_id: block.tool_use_id, content: block.content })
      }
      continue
    }
    messages.push({ role: 'user', content: userContent(content) })
  }
  return messages
}

/** 只下发客户端工具；deepseek 服务端工具（web_search / read_url）被丢弃 */
const toOpenAITools = (
  tools: CreateMessageRequest['tools']
): OpenAIRequest['tools'] => {
  const converted = tools.flatMap((tool): NonNullable<OpenAIRequest['tools']> => {
    if ('input_schema' in tool && 'name' in tool) {
      return [
        {
          type: 'function',
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.input_schema,
          },
        },
      ]
    }
    return []
  })
  return converted.length > 0 ? converted : undefined
}

/** 组装 OpenAI chat/completions 请求体 */
export const toOpenAIRequest = (
  provider: CustomProvider,
  body: CreateMessageRequest
): OpenAIRequest => {
  const tools = toOpenAITools(body.tools)
  const request: OpenAIRequest = {
    // 优先用当前选中的模型（模型选择器列出的就是自定义端点的模型），缺省时用提供商配置的模型
    model: body.model.trim() === '' ? provider.model : body.model,
    messages: toOpenAIMessages(body),
    stream: true,
    stream_options: { include_usage: true },
  }
  if (body.temperature !== undefined) {
    request.temperature = body.temperature
  }
  if (body.top_p !== undefined) {
    request.top_p = body.top_p
  }
  if (body.max_tokens !== undefined) {
    request.max_tokens = body.max_tokens
  }
  if (body.reasoning_effort !== undefined) {
    request.reasoning_effort = body.reasoning_effort
  }
  if (tools) {
    request.tools = tools
    request.tool_choice = 'auto'
  }
  return request
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const str = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined

const num = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

const readUsage = (value: unknown): MessageUsage | undefined => {
  if (!isRecord(value)) {
    return undefined
  }
  const input = num(value.prompt_tokens)
  const output = num(value.completion_tokens)
  const cached =
    isRecord(value.prompt_tokens_details) && typeof value.prompt_tokens_details.cached_tokens === 'number'
      ? value.prompt_tokens_details.cached_tokens
      : typeof value.cached_tokens === 'number'
        ? value.cached_tokens
        : 0
  if (input === undefined || output === undefined) {
    return undefined
  }
  return {
    input_tokens: input,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: cached,
    output_tokens: output,
  }
}

const FINISH_REASON: Record<string, 'end_turn' | 'max_tokens' | 'tool_use' | 'refusal'> = {
  stop: 'end_turn',
  length: 'max_tokens',
  tool_calls: 'tool_use',
  function_call: 'tool_use',
  content_filter: 'refusal',
}

/** 流式响应的块管理：思考块 → 正文块 → 工具块，按需开启、按协议关闭 */
class BlockTracker {
  private nextIndex = 0
  private thinkingIndex: number | null = null
  private textIndex: number | null = null
  /** OpenAI delta 里的 tool_calls[].index → 我们的内容块 index */
  private toolIndexes = new Map<number, number>()
  private finished = false

  constructor(private readonly messageId: string) {}

  private openThinking(): MessageStreamEvent[] {
    if (this.thinkingIndex !== null) {
      return []
    }
    const prefix = this.closeText()
    this.thinkingIndex = this.nextIndex++
    return [
      ...prefix,
      {
        type: 'content_block_start',
        index: this.thinkingIndex,
        content_block: { type: 'thinking', thinking: '', signature: this.messageId },
      },
    ]
  }

  private closeThinking(): MessageStreamEvent[] {
    if (this.thinkingIndex === null) {
      return []
    }
    const events: MessageStreamEvent[] = [
      { type: 'content_block_stop', index: this.thinkingIndex },
    ]
    this.thinkingIndex = null
    return events
  }

  private openText(): MessageStreamEvent[] {
    if (this.textIndex !== null) {
      return []
    }
    const prefix = this.closeThinking()
    this.textIndex = this.nextIndex++
    return [
      ...prefix,
      {
        type: 'content_block_start',
        index: this.textIndex,
        content_block: { type: 'text', text: '' },
      },
    ]
  }

  private closeText(): MessageStreamEvent[] {
    if (this.textIndex === null) {
      return []
    }
    const events: MessageStreamEvent[] = [{ type: 'content_block_stop', index: this.textIndex }]
    this.textIndex = null
    return events
  }

  reasoning(delta: string): MessageStreamEvent[] {
    return [
      ...this.openThinking(),
      {
        type: 'content_block_delta',
        index: this.thinkingIndex as number,
        delta: { type: 'thinking_delta', thinking: delta },
      },
    ]
  }

  text(delta: string): MessageStreamEvent[] {
    return [
      ...this.openText(),
      {
        type: 'content_block_delta',
        index: this.textIndex as number,
        delta: { type: 'text_delta', text: delta },
      },
    ]
  }

  toolCall(toolDelta: {
    index?: number
    id?: string
    function?: { name?: string; arguments?: string }
  }): MessageStreamEvent[] {
    const slot = toolDelta.index ?? 0
    const events: MessageStreamEvent[] = [...this.closeText(), ...this.closeThinking()]
    let index = this.toolIndexes.get(slot)
    if (index === undefined) {
      index = this.nextIndex++
      this.toolIndexes.set(slot, index)
      events.push({
        type: 'content_block_start',
        index,
        content_block: {
          type: 'tool_use',
          id: toolDelta.id ?? `call_${createId().replaceAll('-', '').slice(0, 24)}`,
          name: toolDelta.function?.name ?? '',
          input: {},
        },
      })
    }
    if (toolDelta.function?.arguments) {
      events.push({
        type: 'content_block_delta',
        index,
        delta: { type: 'input_json_delta', partial_json: toolDelta.function.arguments },
      })
    }
    return events
  }

  finish(
    reason: string | null | undefined,
    usage: MessageUsage | undefined
  ): MessageStreamEvent[] {
    if (this.finished) {
      return []
    }
    this.finished = true
    const stopReason =
      (reason && FINISH_REASON[reason]) || (this.toolIndexes.size > 0 ? 'tool_use' : 'end_turn')
    const events: MessageStreamEvent[] = [
      ...this.closeThinking(),
      ...this.closeText(),
      ...[...this.toolIndexes.values()].map(
        (index): MessageStreamEvent => ({ type: 'content_block_stop', index })
      ),
      {
        type: 'message_delta',
        delta: { stop_reason: stopReason, stop_sequence: null },
        ...(usage ? { usage } : {}),
      },
      { type: 'message_stop' },
    ]
    return events
  }
}

/**
 * 用给定的提供商发起 POST /chat/completions（stream: true），把 OpenAI SSE 流翻译成
 * 内部的 MessageStreamEvent 序列。非 2xx 响应抛 ApiError；中止时透出 signal 的错误。
 */
export async function* streamOpenAICompatibleMessage(
  provider: CustomProvider,
  body: CreateMessageRequest,
  signal: AbortSignal
): AsyncGenerator<MessageStreamEvent> {
  const openaiBody = toOpenAIRequest(provider, body)
  const response = await request(chatCompletionsUrl(provider.baseURL), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${provider.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify(openaiBody),
    signal,
  })
  const contentType = response.headers.get('Content-Type') ?? ''
  if (!response.body || !contentType.includes('text/event-stream')) {
    // 有些端点错误时返回 200 + JSON；当作协议错误展示原文
    const text = await response.text().catch(() => '')
    throw new ApiError('protocol', text || 'endpoint did not return an SSE stream')
  }

  const messageId = createId()
  let started = false
  let model = provider.model
  let usage: MessageUsage | undefined
  const tracker = new BlockTracker(messageId)
  let finished = false

  for await (const { data } of readServerSentEvents(response.body, signal)) {
    if (data === '[DONE]') {
      // 服务端没给 finish_reason 也没报错：正常收尾
      if (!finished) {
        finished = true
        for (const event of tracker.finish(undefined, usage)) {
          yield event
        }
      }
      return
    }
    let chunk: unknown
    try {
      chunk = JSON.parse(data)
    } catch {
      continue
    }
    if (!isRecord(chunk)) {
      continue
    }
    if (isRecord(chunk.error) && typeof chunk.error.message === 'string') {
      throw new ApiError('stream', chunk.error.message)
    }
    if (!started) {
      started = true
      model = str(chunk.model) ?? model
      usage = readUsage(chunk.usage)
      yield {
        type: 'message_start',
        message: {
          id: str(chunk.id) ?? messageId,
          model,
          usage: usage ?? {
            input_tokens: 0,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
            output_tokens: 0,
          },
        },
      }
    }
    usage = readUsage(chunk.usage) ?? usage
    const choice = Array.isArray(chunk.choices) ? chunk.choices[0] : undefined
    if (isRecord(choice)) {
      const delta = isRecord(choice.delta) ? choice.delta : undefined
      if (delta) {
        // DeepSeek 风格 reasoning_content；有些端点用 reasoning
        const reasoning = str(delta.reasoning_content) ?? str(delta.reasoning)
        if (reasoning) {
          for (const event of tracker.reasoning(reasoning)) {
            yield event
          }
        }
        const text = str(delta.content)
        if (text) {
          for (const event of tracker.text(text)) {
            yield event
          }
        }
        if (Array.isArray(delta.tool_calls)) {
          for (const toolDelta of delta.tool_calls) {
            if (!isRecord(toolDelta)) {
              continue
            }
            const fn = isRecord(toolDelta.function) ? toolDelta.function : undefined
            for (const event of tracker.toolCall({
              index: num(toolDelta.index),
              id: str(toolDelta.id),
              function: fn
                ? { name: str(fn.name), arguments: str(fn.arguments) }
                : undefined,
            })) {
              yield event
            }
          }
        }
      }
      const finishReason = str(choice.finish_reason)
      if (finishReason) {
        finished = true
        for (const event of tracker.finish(finishReason, usage)) {
          yield event
        }
      }
    }
  }
  if (!finished) {
    // 流在 finish_reason / [DONE] 之前结束
    throw new ApiError('interrupted', '')
  }
}

/** GET /models 校验自定义端点与 Key（OpenAI 兼容，无费用） */
export const verifyOpenAICompatible = async (
  provider: CustomProvider,
  signal?: AbortSignal
): Promise<void> => {
  await request(modelsUrl(provider.baseURL), {
    method: 'GET',
    headers: { Authorization: `Bearer ${provider.apiKey}` },
    signal,
  })
}

/** GET /models 拉取可用模型 id 列表；失败抛出错误供调用方提示 */
export const fetchOpenAICompatibleModels = async (
  provider: CustomProvider,
  signal?: AbortSignal
): Promise<string[]> => {
  const response = await request(modelsUrl(provider.baseURL), {
    method: 'GET',
    headers: { Authorization: `Bearer ${provider.apiKey}`, Accept: 'application/json' },
    signal,
  })
  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    return []
  }
  if (!isRecord(payload)) {
    return []
  }
  const list = Array.isArray(payload.data)
    ? payload.data
    : Array.isArray(payload.models)
      ? payload.models
      : []
  const seen = new Set<string>()
  const ids: string[] = []
  for (const item of list) {
    const id =
      typeof item === 'string'
        ? item
        : isRecord(item) && typeof item.id === 'string'
          ? item.id
          : isRecord(item) && typeof item.name === 'string'
            ? item.name
            : ''
    if (id && !seen.has(id)) {
      seen.add(id)
      ids.push(id)
    }
  }
  return ids
}
