import { create } from 'zustand'
import {
  opfsClear,
  opfsDeleteFile,
  opfsReadAll,
  opfsSupported,
  opfsWriteAll,
  opfsWriteFile,
} from './opfs.js'

/**
 * 虚拟长期文件工作区：完全活在 localStorage 里的一个「文件系统」。
 *
 * 用途：让浏览器里的 Agent 有一个可以反复读写的持久位置，用户也能直接编辑、
 * 导入导出，不需要真正的磁盘或后端。所有内容只存在当前浏览器。
 *
 * 限制（避免把 localStorage 写爆）：
 * - 单文件 200k 字符、总量 1.5M 字符、最多 200 个文件；
 * - 路径只允许相对路径，禁止 `..` 与绝对路径，防止出现奇怪的键名。
 */

const STORE_KEY = 'chat-demo:workspace'
const ENABLED_KEY = 'chat-demo:workspace-enabled'
const MODE_KEY = 'chat-demo:workspace-mode'

/** 工作区底层存储：浏览器 localStorage 或 OPFS 真文件系统 */
export type WorkspaceMode = 'local' | 'opfs'

export const WORKSPACE_MAX_FILES = 200
export const WORKSPACE_MAX_FILE_CHARS = 200_000
export const WORKSPACE_MAX_TOTAL_CHARS = 1_500_000

export type WorkspaceFile = {
  /** 相对路径，例如 notes/todo.md */
  path: string
  content: string
  mime: string
  createdAt: number
  updatedAt: number
  /** 进入工作区时的初始内容，用于「查看 diff」 */
  baseline?: string
}

type WorkspaceState = {
  /** 工作区总开关；默认关闭 */
  enabled: boolean
  /** 当前存储方式；默认 localStorage，可切换到 OPFS */
  mode: WorkspaceMode
  /** OPFS 模式下的异步加载是否完成 */
  hydrated: boolean
  /** 最近一次异步写盘失败的原因，设置页会提示 */
  persistError: string | null
  files: Record<string, WorkspaceFile>
}

/** 导出包格式：只含文本文件，便于用户自己备份或迁移 */
export type WorkspaceArchive = {
  kind: 'chat-demo-workspace'
  version: 1
  exportedAt: string
  files: { path: string; content: string; mime: string; updatedAt: number }[]
}

const MIME_BY_EXT: Record<string, string> = {
  md: 'text/markdown',
  txt: 'text/plain',
  csv: 'text/csv',
  json: 'application/json',
  html: 'text/html',
  htm: 'text/html',
  svg: 'image/svg+xml',
  xml: 'application/xml',
  yml: 'text/yaml',
  yaml: 'text/yaml',
  js: 'text/javascript',
  ts: 'text/typescript',
  tsx: 'text/typescript',
  jsx: 'text/javascript',
  py: 'text/x-python',
  css: 'text/css',
  sh: 'text/x-shellscript',
  toml: 'text/toml',
}

export const mimeForPath = (path: string): string => {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  return MIME_BY_EXT[ext] ?? 'text/plain'
}

/** 规范化路径：去掉开头斜杠、折叠多余分隔符，拒绝越界路径 */
export const normalizeWorkspacePath = (input: string): string | null => {
  const raw = input.trim().replace(/\\/g, '/')
  if (raw === '') {
    return null
  }
  if (raw.startsWith('/') || /^[a-zA-Z]:/.test(raw)) {
    return null
  }
  const parts: string[] = []
  for (const segment of raw.split('/')) {
    if (segment === '' || segment === '.') {
      continue
    }
    if (segment === '..') {
      return null
    }
    parts.push(segment)
  }
  if (parts.length === 0) {
    return null
  }
  const path = parts.join('/')
  return path.length > 200 ? path.slice(0, 200) : path
}

const charTotal = (files: Record<string, WorkspaceFile>): number =>
  Object.values(files).reduce((sum, file) => sum + file.content.length, 0)

const readFiles = (): Record<string, WorkspaceFile> => {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (!raw) {
      return {}
    }
    const parsed: unknown = JSON.parse(raw)
    const entries =
      typeof parsed === 'object' && parsed !== null && 'files' in parsed
        ? (parsed as { files: unknown }).files
        : parsed
    if (typeof entries !== 'object' || entries === null) {
      return {}
    }
    const files: Record<string, WorkspaceFile> = {}
    for (const [path, value] of Object.entries(entries as Record<string, unknown>)) {
      const item = value as Partial<WorkspaceFile>
      if (typeof item?.content !== 'string') {
        continue
      }
      const safePath = normalizeWorkspacePath(path)
      if (!safePath) {
        continue
      }
      files[safePath] = {
        path: safePath,
        content: item.content.slice(0, WORKSPACE_MAX_FILE_CHARS),
        mime: typeof item.mime === 'string' ? item.mime : mimeForPath(safePath),
        createdAt: typeof item.createdAt === 'number' ? item.createdAt : Date.now(),
        updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : Date.now(),
        baseline: typeof item.baseline === 'string' ? item.baseline : undefined,
      }
    }
    return files
  } catch {
    // 损坏的 JSON 当作空工作区，不要影响应用启动
    return {}
  }
}

const writeFiles = (files: Record<string, WorkspaceFile>) => {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ version: 1, files }))
  } catch {
    // 空间不足时忽略：调用方会先做容量检查
  }
}

const readMode = (): WorkspaceMode =>
  localStorage.getItem(MODE_KEY) === 'opfs' && opfsSupported() ? 'opfs' : 'local'

export const useWorkspace = create<WorkspaceState>(() => ({
  enabled: localStorage.getItem(ENABLED_KEY) === 'true',
  mode: readMode(),
  // localStorage 同步读完了；OPFS 需要异步 hydrate，先标记为已就绪再由 hydrateWorkspace 修正
  hydrated: localStorage.getItem(MODE_KEY) !== 'opfs' || !opfsSupported(),
  persistError: null,
  files: localStorage.getItem(MODE_KEY) === 'opfs' && opfsSupported() ? {} : readFiles(),
}))

/** 串行执行 OPFS 写操作，避免并发 createWritable 互相覆盖 */
let persistQueue: Promise<void> = Promise.resolve()

const queuePersist = (task: () => Promise<void>) => {
  persistQueue = persistQueue
    .then(task)
    .then(() => {
      if (useWorkspace.getState().persistError) {
        useWorkspace.setState({ persistError: null })
      }
    })
    .catch((error: unknown) => {
      useWorkspace.setState({
        persistError: error instanceof Error ? error.message : String(error),
      })
    })
}

export const setWorkspaceEnabled = (enabled: boolean) => {
  try {
    localStorage.setItem(ENABLED_KEY, String(enabled))
  } catch {
    // 隐私模式忽略
  }
  useWorkspace.setState({ enabled })
}

export const isWorkspaceEnabled = () => useWorkspace.getState().enabled

export type SaveResult =
  | { ok: true; file: WorkspaceFile; created: boolean }
  | { ok: false; reason: 'path' | 'tooLarge' | 'tooManyFiles' | 'totalTooLarge' }

/**
 * 写入文件：存在则覆盖并保留 baseline（首次创建时的内容），不存在则新建。
 * 容量检查在写入前完成，失败时返回原因而不是静默截断。
 */
export const saveWorkspaceFile = (
  inputPath: string,
  content: string,
  options: { mime?: string } = {}
): SaveResult => {
  const path = normalizeWorkspacePath(inputPath)
  if (!path) {
    return { ok: false, reason: 'path' }
  }
  if (content.length > WORKSPACE_MAX_FILE_CHARS) {
    return { ok: false, reason: 'tooLarge' }
  }
  const current = useWorkspace.getState().files
  const existing = current[path]
  if (!existing && Object.keys(current).length >= WORKSPACE_MAX_FILES) {
    return { ok: false, reason: 'tooManyFiles' }
  }
  const totalAfter = charTotal(current) - (existing?.content.length ?? 0) + content.length
  if (totalAfter > WORKSPACE_MAX_TOTAL_CHARS) {
    return { ok: false, reason: 'totalTooLarge' }
  }
  const now = Date.now()
  const file: WorkspaceFile = {
    path,
    content,
    mime: options.mime ?? existing?.mime ?? mimeForPath(path),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    baseline: existing?.baseline ?? existing?.content ?? content,
  }
  const files = { ...current, [path]: file }
  useWorkspace.setState({ files })
  if (useWorkspace.getState().mode === 'opfs') {
    queuePersist(() => opfsWriteFile(path, content))
  } else {
    writeFiles(files)
  }
  return { ok: true, file, created: !existing }
}

export const readWorkspaceFile = (inputPath: string): WorkspaceFile | null => {
  const path = normalizeWorkspacePath(inputPath)
  if (!path) {
    return null
  }
  return useWorkspace.getState().files[path] ?? null
}

export const deleteWorkspaceFile = (inputPath: string): boolean => {
  const path = normalizeWorkspacePath(inputPath)
  if (!path || !Object.hasOwn(useWorkspace.getState().files, path)) {
    return false
  }
  // 用过滤重建而不是删除动态键，避免对象进入字典模式
  const rest = Object.fromEntries(
    Object.entries(useWorkspace.getState().files).filter(([key]) => key !== path)
  )
  useWorkspace.setState({ files: rest })
  if (useWorkspace.getState().mode === 'opfs') {
    queuePersist(() => opfsDeleteFile(path))
  } else {
    writeFiles(rest)
  }
  return true
}

/** 列表按路径排序，供设置页与工具共用 */
export const listWorkspaceFiles = (): WorkspaceFile[] =>
  Object.values(useWorkspace.getState().files).sort((a, b) => a.path.localeCompare(b.path))

/** 工作区用量：字符数 + 文件数，设置页用来画占用条 */
export const workspaceUsage = (): { files: number; chars: number } => {
  const files = useWorkspace.getState().files
  return { files: Object.keys(files).length, chars: charTotal(files) }
}

/** 导出：文本打包成 JSON，文件名带日期便于归档 */
export const exportWorkspace = (): { name: string; blob: Blob } => {
  const archive: WorkspaceArchive = {
    kind: 'chat-demo-workspace',
    version: 1,
    exportedAt: new Date().toISOString(),
    files: listWorkspaceFiles().map((file) => ({
      path: file.path,
      content: file.content,
      mime: file.mime,
      updatedAt: file.updatedAt,
    })),
  }
  const name = `chat-demo-workspace-${new Date().toISOString().slice(0, 10)}.json`
  return {
    name,
    blob: new Blob([JSON.stringify(archive, null, 2)], { type: 'application/json' }),
  }
}

export type ImportResult = { imported: number; skipped: number; error?: 'format' | 'tooMany' }

/**
 * 导入：merge 只覆盖同名文件，replace 先清空再导入。
 * 非本格式或字段不合法的条目跳过并计数，不让整次导入失败。
 */
export const importWorkspace = (text: string, mode: 'merge' | 'replace'): ImportResult => {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { imported: 0, skipped: 0, error: 'format' }
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { imported: 0, skipped: 0, error: 'format' }
  }
  const record = parsed as Partial<WorkspaceArchive> & { files?: unknown }
  if (record.kind !== 'chat-demo-workspace' || !Array.isArray(record.files)) {
    return { imported: 0, skipped: 0, error: 'format' }
  }
  const base = mode === 'replace' ? {} : { ...useWorkspace.getState().files }
  let imported = 0
  let skipped = 0
  const now = Date.now()
  for (const entry of record.files) {
    if (typeof entry !== 'object' || entry === null) {
      skipped += 1
      continue
    }
    const item = entry as Partial<WorkspaceArchive['files'][number]>
    const path = typeof item.path === 'string' ? normalizeWorkspacePath(item.path) : null
    if (!path || typeof item.content !== 'string') {
      skipped += 1
      continue
    }
    if (
      item.content.length > WORKSPACE_MAX_FILE_CHARS ||
      Object.keys(base).length >= WORKSPACE_MAX_FILES
    ) {
      skipped += 1
      continue
    }
    base[path] = {
      path,
      content: item.content,
      mime: typeof item.mime === 'string' ? item.mime : mimeForPath(path),
      createdAt: now,
      updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : now,
      // 导入时把当前内容当作基线，diff 从这里开始算
      baseline: item.content,
    }
    imported += 1
  }
  if (imported === 0 && skipped === 0) {
    return { imported: 0, skipped: 0, error: 'format' }
  }
  if (charTotal(base) > WORKSPACE_MAX_TOTAL_CHARS) {
    return { imported: 0, skipped, error: 'tooMany' }
  }
  useWorkspace.setState({ files: base })
  if (useWorkspace.getState().mode === 'opfs') {
    queuePersist(() =>
      opfsWriteAll(Object.fromEntries(Object.entries(base).map(([path, file]) => [path, file.content])))
    )
  } else {
    writeFiles(base)
  }
  return { imported, skipped }
}

export const clearWorkspace = () => {
  useWorkspace.setState({ files: {} })
  if (useWorkspace.getState().mode === 'opfs') {
    queuePersist(() => opfsClear())
  } else {
    writeFiles({})
  }
}

/**
 * 启动时加载 OPFS 工作区。localStorage 模式不需要异步动作。
 * OPFS 里读到的文件把当前内容同时作为基线，diff 从加载后开始算。
 */
export const hydrateWorkspace = async (): Promise<void> => {
  if (useWorkspace.getState().mode !== 'opfs' || !opfsSupported()) {
    useWorkspace.setState({ hydrated: true })
    return
  }
  try {
    const raw = await opfsReadAll()
    const now = Date.now()
    const files: Record<string, WorkspaceFile> = {}
    for (const [path, content] of Object.entries(raw)) {
      const safePath = normalizeWorkspacePath(path)
      if (!safePath) {
        continue
      }
      files[safePath] = {
        path: safePath,
        content: content.slice(0, WORKSPACE_MAX_FILE_CHARS),
        mime: mimeForPath(safePath),
        createdAt: now,
        updatedAt: now,
        baseline: content,
      }
    }
    useWorkspace.setState({ files, hydrated: true, persistError: null })
  } catch (error) {
    useWorkspace.setState({
      hydrated: true,
      persistError: error instanceof Error ? error.message : String(error),
    })
  }
}

/**
 * 切换存储方式：把当前内存里的文件整体写到新后端，成功后写模式键。
 * 切到 OPFS 时如果浏览器不支持，返回错误而不改模式。
 */
export const setWorkspaceMode = async (mode: WorkspaceMode): Promise<WorkspaceMode> => {
  if (mode === 'opfs' && !opfsSupported()) {
    return useWorkspace.getState().mode
  }
  const files = useWorkspace.getState().files
  if (mode === 'opfs') {
    await opfsWriteAll(
      Object.fromEntries(Object.entries(files).map(([path, file]) => [path, file.content]))
    )
  } else {
    writeFiles(files)
  }
  try {
    localStorage.setItem(MODE_KEY, mode)
  } catch {
    // 隐私模式写不进去时至少本次会话生效
  }
  useWorkspace.setState({ mode, hydrated: true, persistError: null })
  return mode
}

/** 当前是否使用 OPFS；设置页用来显示状态 */
export const isOpfsMode = (): boolean => useWorkspace.getState().mode === 'opfs'

/** 简单的按行 diff：返回新增 / 删除行数，供工具的「查看 diff」使用 */
export type DiffSummary = { added: number; removed: number; lines: string[] }

export const diffWorkspaceFile = (file: WorkspaceFile, maxLines = 200): DiffSummary => {
  const before = (file.baseline ?? '').split('\n')
  const after = file.content.split('\n')
  const lines: string[] = []
  let added = 0
  let removed = 0
  const max = Math.max(before.length, after.length)
  for (let index = 0; index < max; index += 1) {
    const oldLine = before[index]
    const newLine = after[index]
    if (oldLine === newLine) {
      continue
    }
    if (oldLine !== undefined) {
      removed += 1
      if (lines.length < maxLines) {
        lines.push(`- ${oldLine}`)
      }
    }
    if (newLine !== undefined) {
      added += 1
      if (lines.length < maxLines) {
        lines.push(`+ ${newLine}`)
      }
    }
  }
  return { added, removed, lines }
}
