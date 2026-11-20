import { readServerSentEvents } from './sse.js'
import type { CreateMessageRequest, MessageParam, MessageStreamEvent } from './types.js'

const textOf = (content: MessageParam['content']): string => {
  if (typeof content === 'string') {
    return content
  }
  return content
    .map((block) => {
      if (block.type === 'text' && 'text' in block) {
        return block.text
      }
      if (block.type === 'tool_result') {
        return block.content
      }
      if (block.type === 'image' || block.type === 'document') {
        return '[attachment]'
      }
      return ''
    })
    .join('\n')
}

const responsesInput = (body: CreateMessageRequest) =>
  body.messages.flatMap((message) => {
    const text = textOf(message.content)
    if (!text) {
      return []
    }
    if (message.role === 'latest_reminder') {
      return [{ role: 'user', content: [{ type: 'input_text', text }] }]
    }
    return [{ role: message.role, content: [{ type: message.role === 'assistant' ? 'output_text' : 'input_text', text }] }]
  })

const responseTools = (body: CreateMessageRequest) =>
  body.tools.flatMap((tool) => {
    if (!('input_schema' in tool) || !('name' in tool)) {
      return []
    }
    return [{ type: 'function', name: tool.name, description: tool.description, parameters: tool.input_schema }]
  })

export const toResponsesRequest = (body: CreateMessageRequest) => ({
  model: body.model,
  instructions: body.system || undefined,
  input: responsesInput(body),
  stream: true,
  store: false,
  ...(body.temperature !== undefined ? { temperature: body.temperature } : {}),
  ...(body.top_p !== undefined ? { top_p: body.top_p } : {}),
  ...(body.max_tokens !== undefined ? { max_output_tokens: body.max_tokens } : {}),
  ...(body.reasoning_effort !== undefined ? { reasoning: { effort: body.reasoning_effort } } : {}),
  ...(responseTools(body).length ? { tools: responseTools(body), tool_choice: 'auto' } : {}),
})

const usageOf = (usage: Record<string, unknown> | undefined) => {
  if (!usage) {
    return undefined
  }
  const input = typeof usage.input_tokens === 'number' ? usage.input_tokens : 0
  const output = typeof usage.output_tokens === 'number' ? usage.output_tokens : 0
  return {
    input_tokens: input,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    output_tokens: output,
  }
}

export async function* streamChatGPTMessage(
  body: CreateMessageRequest,
  signal: AbortSignal
): AsyncGenerator<MessageStreamEvent> {
  const response = await fetch('/api/chatgpt/responses', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(toResponsesRequest(body)),
    signal,
  })
  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => '')
    throw new Error(text || `ChatGPT request failed (${response.status})`)
  }
  let index = 0
  let toolUse = false
  yield { type: 'message_start', message: { id: crypto.randomUUID(), model: body.model } }
  for await (const { event: eventName, data } of readServerSentEvents(response.body, signal)) {
    let payload: Record<string, unknown>
    try {
      payload = JSON.parse(data) as Record<string, unknown>
    } catch {
      continue
    }
    if (eventName === 'response.output_text.delta' && typeof payload.delta === 'string') {
      yield { type: 'content_block_delta', index, delta: { type: 'text_delta', text: payload.delta } }
    } else if (eventName === 'response.output_item.added' && typeof payload.item === 'object' && payload.item !== null) {
      const item = payload.item as Record<string, unknown>
      if (item.type === 'function_call') {
        toolUse = true
        yield {
          type: 'content_block_start',
          index,
          content_block: { type: 'tool_use', id: String(item.call_id ?? item.id ?? crypto.randomUUID()), name: String(item.name ?? 'tool'), input: {} },
        }
      }
    } else if (eventName === 'response.function_call_arguments.delta' && typeof payload.delta === 'string') {
      yield { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: payload.delta } }
    } else if (eventName === 'response.output_item.done') {
      yield { type: 'content_block_stop', index }
      index += 1
    } else if (eventName === 'response.completed') {
      const responseData = typeof payload.response === 'object' && payload.response !== null ? payload.response as Record<string, unknown> : undefined
      const usage = responseData && typeof responseData.usage === 'object' && responseData.usage !== null ? usageOf(responseData.usage as Record<string, unknown>) : undefined
      yield { type: 'message_delta', delta: { stop_reason: toolUse ? 'tool_use' : 'end_turn', stop_sequence: null }, ...(usage ? { usage } : {}) }
      yield { type: 'message_stop' }
    }
  }
}
