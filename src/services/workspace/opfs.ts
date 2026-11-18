/**
 * OPFS（Origin Private File System）适配层。
 *
 * 与 localStorage 的区别：真正的文件系统，页面刷新 / 浏览器重启后仍在，
 * 不受 localStorage 5MB 级别限制，但需要异步 API。这里只做「整个工作区」
 * 的读写，路径仍然是虚拟工作区里那套相对路径。
 *
 * 不支持 OPFS 的浏览器（老 WebView / 隐私模式）会由上层回落到 localStorage。
 */

const ROOT_DIR = 'chat-demo-workspace'

/** 当前环境是否支持 OPFS */
export const opfsSupported = (): boolean =>
  typeof navigator !== 'undefined' && typeof navigator.storage?.getDirectory === 'function'

const rootDirectory = async (): Promise<FileSystemDirectoryHandle> => {
  const root = await navigator.storage.getDirectory()
  return root.getDirectoryHandle(ROOT_DIR, { create: true })
}

/** 按相对路径拿到文件句柄，自动创建中间目录 */
const fileHandle = async (path: string, create: boolean): Promise<FileSystemFileHandle> => {
  const parts = path.split('/').filter(Boolean)
  const name = parts.pop()
  if (!name) {
    throw new Error(`无效路径：${path}`)
  }
  let dir = await rootDirectory()
  for (const part of parts) {
    dir = await dir.getDirectoryHandle(part, { create })
  }
  return dir.getFileHandle(name, { create })
}

/** 递归列出目录下的所有文本文件路径 */
const walk = async (
  dir: FileSystemDirectoryHandle,
  prefix: string,
  out: string[]
): Promise<void> => {
  for await (const [name, handle] of dir.entries()) {
    const path = prefix ? `${prefix}/${name}` : name
    if (handle.kind === 'directory') {
      await walk(handle as FileSystemDirectoryHandle, path, out)
    } else {
      out.push(path)
    }
  }
}

/** 读取整个工作区；返回 路径 → 原始字节 */
export const opfsReadAll = async (): Promise<Record<string, Uint8Array>> => {
  if (!opfsSupported()) {
    return {}
  }
  const files: Record<string, Uint8Array> = {}
  const paths: string[] = []
  await walk(await rootDirectory(), '', paths)
  for (const path of paths) {
    try {
      const handle = await fileHandle(path, false)
      const buffer = await (await handle.getFile()).arrayBuffer()
      files[path] = new Uint8Array(buffer)
    } catch {
      // 单个文件读失败不影响其它文件
    }
  }
  return files
}

/** 写入一个文件（覆盖），必要时创建目录；按原始字节写，二进制不会损坏 */
export const opfsWriteFile = async (path: string, bytes: Uint8Array): Promise<void> => {
  const handle = await fileHandle(path, true)
  const writable = await handle.createWritable()
  try {
    // 复制到独立的 ArrayBuffer，避免 SharedArrayBuffer / 视图偏移导致的类型与写入问题
    const copy = new Uint8Array(bytes.byteLength)
    copy.set(bytes)
    await writable.write(copy)
  } finally {
    await writable.close()
  }
}

/** 删除一个文件；不存在时静默返回 */
export const opfsDeleteFile = async (path: string): Promise<void> => {
  const parts = path.split('/').filter(Boolean)
  const name = parts.pop()
  if (!name) {
    return
  }
  let dir = await rootDirectory()
  for (const part of parts) {
    dir = await dir.getDirectoryHandle(part, { create: false })
  }
  await dir.removeEntry(name)
}

/** 清空整个工作区目录 */
export const opfsClear = async (): Promise<void> => {
  if (!opfsSupported()) {
    return
  }
  const root = await navigator.storage.getDirectory()
  try {
    await root.removeEntry(ROOT_DIR, { recursive: true })
  } catch {
    // 目录不存在时忽略
  }
}

/** 把一组文件整体写入 OPFS（模式切换 / 导入时用） */
export const opfsWriteAll = async (files: Record<string, Uint8Array>): Promise<void> => {
  await opfsClear()
  for (const [path, bytes] of Object.entries(files)) {
    await opfsWriteFile(path, bytes)
  }
}

// ---------- 持久化存储与配额 ----------

export type StorageStatus = {
  supported: boolean
  persisted: boolean
  usage: number | null
  quota: number | null
}

/** 读取持久化状态与配额；不支持时返回 supported: false */
export const readStorageStatus = async (): Promise<StorageStatus> => {
  if (typeof navigator === 'undefined' || !navigator.storage) {
    return { supported: false, persisted: false, usage: null, quota: null }
  }
  const [persisted, estimate] = await Promise.all([
    navigator.storage.persisted?.().catch(() => false) ?? Promise.resolve(false),
    navigator.storage.estimate?.().catch(() => null) ?? Promise.resolve(null),
  ])
  return {
    supported: true,
    persisted: Boolean(persisted),
    usage: typeof estimate?.usage === 'number' ? estimate.usage : null,
    quota: typeof estimate?.quota === 'number' ? estimate.quota : null,
  }
}

/**
 * 申请持久化存储：浏览器可能直接授予，也可能按站点互动度自动决定。
 * 返回最终是否处于持久化状态。
 */
export const requestPersistentStorage = async (): Promise<boolean> => {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) {
    return false
  }
  try {
    return await navigator.storage.persist()
  } catch {
    return false
  }
}
