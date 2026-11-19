/**
 * 发送前把本地附件预读成 data URL 的暂存区。OpenAI 兼容端点没有 DeepSeek Files API，
 * 图片只能随请求以 base64 下发、文本类文件以原文下发，所以文件字节要在整条
 * 同步的 消息构造 流水线里可读到。
 *
 * 只在一次请求构造期间有效：prepareFiles 开始时清空并填充，发请求前读取；
 * 不落盘、不进会话历史，因此不会把大体积 base64 写进 IndexedDB。
 */
export type InlineAttachment = {
  isImage: boolean
  mimeType: string
  name: string
  /** 图片为 data URL；文本文件为其原文内容（不含 data URL 前缀） */
  dataUrl: string
  /** 文本文件内联时的原文；图片不使用 */
  text?: string
}

const staged = new Map<string, InlineAttachment>()

/** 开始一次请求的附件预读：清掉上一次残留 */
export const beginInlineAttachments = (): void => {
  staged.clear()
}

export const setInlineAttachment = (id: string, value: InlineAttachment): void => {
  staged.set(id, value)
}

/** 读取（不消费）暂存的附件；消息构造期间可多次读取 */
export const inlineAttachment = (id: string): InlineAttachment | undefined => staged.get(id)

/** 丢弃暂存内容，释放内存 */
export const clearInlineAttachments = (): void => {
  staged.clear()
}

/** Blob → data URL，例如 image/png;base64,iVBOR... */
export const blobToDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('read failed'))
    reader.readAsDataURL(blob)
  })
