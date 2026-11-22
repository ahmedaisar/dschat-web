import { create } from 'zustand'
import { createId } from '../../utils/id.js'
import { useSettings } from '../settings.js'
import { streamMessage } from '../api/client.js'
import { translate } from '../../i18n/index.js'
import { removeSavedMemoryNode, upsertSavedMemoryNode } from './memoryBank.js'

/**
 * 长期记忆（参考 DeepChat 的 SavedMemory）：
 * - 手动添加 / 编辑 / 启停 / 删除；
 * - 每轮结束后可静默提炼新的长期事实；
 * - 启用的记忆在请求时注入 system，并同步到网状记忆库。
 */

export type SavedMemoryItem = {
  id: string
  content: string
  enabled: boolean
  updatedAt: number
}

const STORAGE_KEY = 'chat-demo:saved-memories'
const MAX_MEMORY_CHARS = 1800
const EXTRACTOR_TIMEOUT = 15_000

const read = (): SavedMemoryItem[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return []
    }
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      return []
    }
    return parsed.filter(
      (item): item is SavedMemoryItem =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as SavedMemoryItem).id === 'string' &&
        typeof (item as SavedMemoryItem).content === 'string' &&
        typeof (item as SavedMemoryItem).enabled === 'boolean' &&
        typeof (item as SavedMemoryItem).updatedAt === 'number'
    )
  } catch {
    return []
  }
}

const write = (items: SavedMemoryItem[]) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
  } catch {
    // 存储不可用时只保留内存状态
  }
}

export const useSavedMemories = create<{ items: SavedMemoryItem[] }>(() => ({
  items: read(),
}))

const syncToBank = (item: SavedMemoryItem) => {
  if (item.enabled) {
    upsertSavedMemoryNode(item.id, item.content, useSettings.getState().memoryBankDimension)
  } else {
    removeSavedMemoryNode(item.id)
  }
}

const commit = (items: SavedMemoryItem[]) => {
  write(items)
  useSavedMemories.setState({ items })
}

export const addSavedMemory = (content: string): SavedMemoryItem | null => {
  const text = content.trim()
  if (!text) {
    return null
  }
  const current = useSavedMemories.getState().items
  const duplicate = current.find((item) => item.content.trim() === text)
  if (duplicate) {
    if (!duplicate.enabled) {
      const enabled = { ...duplicate, enabled: true, updatedAt: Date.now() }
      commit(current.map((item) => (item.id === duplicate.id ? enabled : item)))
      syncToBank(enabled)
      return enabled
    }
    return duplicate
  }
  const created: SavedMemoryItem = {
    id: createId(),
    content: text,
    enabled: true,
    updatedAt: Date.now(),
  }
  commit([created, ...current])
  syncToBank(created)
  return created
}

export const updateSavedMemory = (id: string, content: string): boolean => {
  const text = content.trim()
  if (!text) {
    return false
  }
  const current = useSavedMemories.getState().items
  if (!current.some((item) => item.id === id)) {
    return false
  }
  const next = current.map((item) =>
    item.id === id ? { ...item, content: text, updatedAt: Date.now() } : item
  )
  commit(next)
  const updated = next.find((item) => item.id === id)
  if (updated) {
    syncToBank(updated)
  }
  return true
}

export const toggleSavedMemory = (id: string) => {
  const current = useSavedMemories.getState().items
  const next = current.map((item) =>
    item.id === id ? { ...item, enabled: !item.enabled, updatedAt: Date.now() } : item
  )
  commit(next)
  const updated = next.find((item) => item.id === id)
  if (updated) {
    syncToBank(updated)
  }
}

export const deleteSavedMemory = (id: string) => {
  const current = useSavedMemories.getState().items
  commit(current.filter((item) => item.id !== id))
  removeSavedMemoryNode(id)
}

/** 导入记忆归档时整体替换（不自动同步记忆库，归档里通常已包含节点） */
export const replaceSavedMemories = (items: SavedMemoryItem[]) => {
  commit(items)
}

export const clearSavedMemories = () => {
  const current = useSavedMemories.getState().items
  for (const item of current) {
    removeSavedMemoryNode(item.id)
  }
  commit([])
}

/** 启用的长期记忆拼成注入文本 */
export const formatSavedMemories = (): string => {
  const enabled = useSavedMemories
    .getState()
    .items.filter((item) => item.enabled && item.content.trim())
  if (enabled.length === 0) {
    return ''
  }
  const header = translate('memorySavedHeader')
  const lines = [header]
  let total = header.length
  for (const item of enabled) {
    const line = `- ${item.content.trim()}`
    if (total + line.length + 1 > MAX_MEMORY_CHARS && lines.length > 1) {
      break
    }
    lines.push(line)
    total += line.length + 1
  }
  return lines.length > 1 ? lines.join('\n') : ''
}

type MemoryOperation =
  | { action: 'add'; content: string }
  | { action: 'update'; id: string; content: string }
  | { action: 'delete'; id: string }

const EXTRACTOR_SYSTEM_EN = `You extract long-term memory. From this turn, decide whether there is stable information about the user worth saving: identity, occupation, long-term preferences, tools/languages, or an explicit request to remember something.
Rules:
1. Only extract user-originated information with long-term value; skip one-off task details, temporary error codes and small talk.
2. If new information updates or contradicts an existing memory, use update with its id; if the user asks to forget one, use delete; otherwise use add.
3. Never duplicate an existing memory. If nothing should be added or changed, return [].
4. Output only a valid JSON array, with no explanation or Markdown. Example:
[{"action":"add","content":"The user is a frontend engineer who prefers TypeScript"}]`

const parseOperations = (raw: string): MemoryOperation[] => {
  const stripped = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim()
  if (!stripped.startsWith('[')) {
    return []
  }
  try {
    const parsed: unknown = JSON.parse(stripped)
    if (!Array.isArray(parsed)) {
      return []
    }
    const ops: MemoryOperation[] = []
    for (const item of parsed) {
      if (typeof item !== 'object' || item === null) {
        continue
      }
      const record = item as Record<string, unknown>
      if (record.action === 'add' && typeof record.content === 'string' && record.content.trim()) {
        ops.push({ action: 'add', content: record.content.trim() })
      } else if (
        record.action === 'update' &&
        typeof record.id === 'string' &&
        typeof record.content === 'string' &&
        record.content.trim()
      ) {
        ops.push({ action: 'update', id: record.id, content: record.content.trim() })
      } else if (record.action === 'delete' && typeof record.id === 'string') {
        ops.push({ action: 'delete', id: record.id })
      }
    }
    return ops
  } catch {
    return []
  }
}

/** 静默提炼长期记忆；返回是否有变更 */
export const extractMemoriesFromTurn = async ({
  apiKey,
  userText,
  assistantText,
}: {
  apiKey: string
  userText: string
  assistantText: string
}): Promise<boolean> => {
  const question = userText.trim()
  if (!apiKey || !question) {
    return false
  }
  const existing = useSavedMemories.getState().items
  const existingBlock =
    existing.length > 0
      ? existing.map((item) => `[${item.id}] ${item.content}`).join('\n')
      : '(none)'
  const system = EXTRACTOR_SYSTEM_EN
  const prompt = `Existing memories:\n${existingBlock}\n\nThis turn:\nUser: ${question}\nAssistant: ${assistantText.slice(0, 600)}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), EXTRACTOR_TIMEOUT)
  try {
    let output = ''
    const events = streamMessage(
      apiKey,
      {
        model: 'deepseek-flash',
        system,
        messages: [{ role: 'user', content: prompt }],
        thinking: { type: 'disabled' },
        temperature: 0,
        max_tokens: 300,
        tools: [],
      },
      controller.signal
    )
    for await (const event of events) {
      if (event.type === 'content_block_start' && event.content_block.type === 'text') {
        output += event.content_block.text
      } else if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        output += event.delta.text
      }
    }
    const ops = parseOperations(output)
    if (ops.length === 0) {
      return false
    }
    let changed = false
    for (const op of ops) {
      if (op.action === 'add') {
        changed = addSavedMemory(op.content) !== null || changed
      } else if (op.action === 'update') {
        changed = updateSavedMemory(op.id, op.content) || changed
      } else {
        deleteSavedMemory(op.id)
        changed = true
      }
    }
    return changed
  } catch {
    // 提炼失败静默忽略，不影响正常对话
    return false
  } finally {
    clearTimeout(timer)
  }
}
