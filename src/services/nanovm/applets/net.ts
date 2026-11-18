import type { Applet, AppletContext, AppletResult } from '../types.js'
import { dirName, resolvePath } from '../fs.js'
import { fail, interrupted, ok, parseArgs, type FlagSpec, type ParsedArgs } from './helpers.js'

/**
 * 网络命令（curl / wget），全部走浏览器的 fetch。
 *
 * 浏览器里跨域请求受 CORS 限制，这是运行环境的正常限制：失败时给出明确的中文
 * 说明（并提示可能被 CORS 拦下），不会伪装成成功。响应体默认写 stdout，二进制
 * 响应必须用 -o/-O 落文件，避免把乱码灌进终端。
 */

const encoder = new TextEncoder()

const BINARY_HINT = '二进制数据无法写入文本终端'

const wantsHelp = (argv: string[]): boolean =>
  argv.length === 2 && (argv[1] === '--help' || argv[1] === '-h')

const describeError = (error: unknown): string => {
  if (error instanceof Error) {
    const cause = error.cause
    const detail =
      cause instanceof Error && cause.message !== error.message ? `（${cause.message}）` : ''
    return `${error.message}${detail}`
  }
  return String(error)
}

const flagOn = (flags: ParsedArgs['flags'], ...names: string[]): boolean =>
  names.some((name) => flags[name] === true)

const flagText = (flags: ParsedArgs['flags'], ...names: string[]): string | null => {
  for (const name of names) {
    const value = flags[name]
    if (typeof value === 'string') {
      return value
    }
  }
  return null
}

const decodeText = (bytes: Uint8Array): string | null => {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

const hasNul = (bytes: Uint8Array): boolean => {
  const limit = Math.min(bytes.length, 8000)
  for (let index = 0; index < limit; index += 1) {
    if (bytes[index] === 0) {
      return true
    }
  }
  return false
}

const withNewline = (text: string): string =>
  text === '' || text.endsWith('\n') ? text : `${text}\n`

/** 没写协议时按 curl 的习惯补 http:// */
const normalizeUrl = (input: string): string =>
  /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(input) ? input : `http://${input}`

const parseUrl = (input: string): URL | null => {
  try {
    return new URL(input)
  } catch {
    return null
  }
}

/** 解析 `K: V` 形式的请求头 */
const parseHeader = (text: string): [string, string] | null => {
  const index = text.indexOf(':')
  if (index <= 0) {
    return null
  }
  const name = text.slice(0, index).trim()
  const value = text.slice(index + 1).trim()
  return name === '' ? null : [name, value]
}

/** parseArgs 的 flags 只保留最后一个值，-H 可能重复，需要单独收集 */
const collectHeaders = (argv: string[]): string[] => {
  const headers: string[] = []
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--') {
      break
    }
    if (arg === '-H' || arg === '--header') {
      const value = argv[index + 1]
      if (value !== undefined) {
        headers.push(value)
      }
      index += 1
      continue
    }
    if (arg.startsWith('--header=')) {
      headers.push(arg.slice('--header='.length))
      continue
    }
    if (arg.startsWith('-H') && arg.length > 2) {
      headers.push(arg.slice(2))
    }
  }
  return headers
}

const buildHeaders = (list: string[], data: string | null): Headers => {
  const headers = new Headers()
  for (const item of list) {
    const pair = parseHeader(item)
    if (pair) {
      headers.set(pair[0], pair[1])
    }
  }
  // curl 的 -d 默认就是表单编码
  if (data !== null && !headers.has('content-type')) {
    headers.set('Content-Type', 'application/x-www-form-urlencoded')
  }
  return headers
}

const remoteFileName = (target: URL): string => {
  const segment = target.pathname.split('/').filter(Boolean).at(-1) ?? ''
  if (segment === '') {
    return 'index.html'
  }
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

const headersText = (response: Response): string => {
  const status = `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`
  const lines = [status]
  response.headers.forEach((value, name) => {
    lines.push(`${name}: ${value}`)
  })
  return `${lines.join('\n')}\n`
}

type FetchOptions = {
  method: string
  headers: Headers
  body: string | null
  maxTime: number | null
  signal?: AbortSignal
}

type FetchOutcome =
  | { ok: true; response: Response; bytes: Uint8Array }
  | { ok: false; reason: 'network' | 'timeout' | 'aborted'; detail: string }

/**
 * 发一次请求并读完响应体。
 *
 * 这里把三种失败分开：用户 Ctrl+C（aborted）、--max-time 超时、网络 / CORS 失败。
 * 浏览器的 CORS 拦截只会抛 TypeError，文案里会提醒可能是跨域限制。
 */
const performFetch = async (url: string, options: FetchOptions): Promise<FetchOutcome> => {
  if (typeof fetch !== 'function') {
    return { ok: false, reason: 'network', detail: '当前运行环境没有 fetch' }
  }
  // 用函数读取，避免 TS 把属性收窄成「永远不是 true」
  const externalAborted = (): boolean => options.signal?.aborted === true
  if (externalAborted()) {
    return { ok: false, reason: 'aborted', detail: '' }
  }
  const controller = new AbortController()
  const onAbort = () => controller.abort()
  options.signal?.addEventListener('abort', onAbort, { once: true })
  let timedOut = false
  const timer =
    options.maxTime !== null
      ? setTimeout(() => {
          timedOut = true
          controller.abort()
        }, options.maxTime * 1000)
      : null
  try {
    const response = await fetch(url, {
      method: options.method,
      headers: options.headers,
      body: options.body ?? undefined,
      redirect: 'follow',
      signal: controller.signal,
    })
    const buffer = await response.arrayBuffer()
    return { ok: true, response, bytes: new Uint8Array(buffer) }
  } catch (error) {
    if (externalAborted()) {
      return { ok: false, reason: 'aborted', detail: '' }
    }
    if (timedOut) {
      return { ok: false, reason: 'timeout', detail: '' }
    }
    return { ok: false, reason: 'network', detail: describeError(error) }
  } finally {
    if (timer !== null) {
      clearTimeout(timer)
    }
    options.signal?.removeEventListener('abort', onAbort)
  }
}

/** 写文件：自动补父目录，返回错误文案（成功为 null） */
const saveFile = (ctx: AppletContext, targetPath: string, bytes: Uint8Array): string | null => {
  try {
    ctx.fs.mkdir(dirName(targetPath), true)
    ctx.fs.write(targetPath, bytes)
    return null
  } catch (error) {
    return describeError(error)
  }
}

const statusText = (response: Response): string =>
  `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`

const writeOutValue = (name: string, response: Response, bytes: Uint8Array): string => {
  if (name === 'http_code') {
    return String(response.status)
  }
  if (name === 'url_effective') {
    return response.url
  }
  if (name === 'size_download') {
    return String(bytes.byteLength)
  }
  if (name === 'content_type') {
    return response.headers.get('content-type') ?? ''
  }
  if (name === 'redirect_url') {
    return response.redirected ? response.url : ''
  }
  return ''
}

/** `-w` 格式：支持 %{http_code} 这类变量、%% 与 \n */
const formatWriteOut = (format: string, response: Response, bytes: Uint8Array): string => {
  let text = ''
  let index = 0
  while (index < format.length) {
    const char = format[index]
    if (char === '\\' && format[index + 1] === 'n') {
      text += '\n'
      index += 2
      continue
    }
    if (char === '%' && format[index + 1] === '%') {
      text += '%'
      index += 2
      continue
    }
    if (char === '%' && format[index + 1] === '{') {
      const end = format.indexOf('}', index + 2)
      if (end > 0) {
        text += writeOutValue(format.slice(index + 2, end), response, bytes)
        index = end + 1
        continue
      }
    }
    text += char
    index += 1
  }
  return text
}

// ---------- curl ----------

const curlUsage =
  "curl [-sIL] [-o FILE|-O] [-X METHOD] [-H 'K: V'] [-d DATA] [--max-time N] [-w FORMAT] URL"

const curlSpec: FlagSpec = {
  s: 'boolean',
  I: 'boolean',
  L: 'boolean',
  O: 'boolean',
  o: 'value',
  X: 'value',
  H: 'value',
  d: 'value',
  w: 'value',
  m: 'value',
  'max-time': 'value',
  silent: 'boolean',
  head: 'boolean',
  location: 'boolean',
  output: 'value',
  request: 'value',
  header: 'value',
  data: 'value',
  'write-out': 'value',
}

/**
 * curl：默认跟随重定向；响应体写 stdout，-o/-O 落文件；
 * -I 只看响应头；非 2xx 一律报错，不把错误页当成功返回。
 */
const curlApplet: Applet = {
  name: 'curl',
  summary: 'HTTP 请求（fetch）：-o 存文件、-O 用 URL 末段命名、-I 只看响应头',
  summaryEn: 'HTTP requests via fetch with -o/-O/-I/-X/-H/-d support',
  usage: curlUsage,
  run: async (ctx: AppletContext): Promise<AppletResult> => {
    if (wantsHelp(ctx.argv)) {
      return ok(`${curlUsage}\n`)
    }
    const parsed = parseArgs(ctx.argv, curlSpec)
    if (parsed.error) {
      return fail(`curl: ${parsed.error}\n`, 2)
    }
    if (interrupted(ctx)) {
      return { code: 130, stderr: 'curl: interrupted\n' }
    }
    const operands = parsed.operands
    if (operands.length === 0) {
      return fail('curl: 缺少 URL\n', 2)
    }
    if (operands.length > 1) {
      return fail(`curl: 一次只能请求一个 URL（多余：${operands.slice(1).join(' ')}）\n`, 2)
    }
    const target = parseUrl(normalizeUrl(operands[0]))
    if (!target) {
      return fail(`curl: 无效的 URL '${operands[0]}'\n`, 3)
    }
    const silent = flagOn(parsed.flags, 's', 'silent')
    const headOnly = flagOn(parsed.flags, 'I', 'head')
    const remoteName = flagOn(parsed.flags, 'O')
    const output = flagText(parsed.flags, 'o', 'output')
    const data = flagText(parsed.flags, 'd', 'data')
    const writeOut = flagText(parsed.flags, 'w', 'write-out')
    const requestName = flagText(parsed.flags, 'X', 'request')
    const method = requestName ?? (headOnly ? 'HEAD' : data !== null ? 'POST' : 'GET')
    const maxTimeText = flagText(parsed.flags, 'm', 'max-time')
    let maxTime: number | null = null
    if (maxTimeText !== null) {
      maxTime = Number.parseFloat(maxTimeText)
      if (!Number.isFinite(maxTime) || maxTime <= 0) {
        return fail(`curl: --max-time 需要正数秒（收到 '${maxTimeText}'）\n`, 2)
      }
    }
    let headers: Headers
    try {
      headers = buildHeaders(collectHeaders(ctx.argv), data)
    } catch (error) {
      return fail(`curl: 请求头无效：${describeError(error)}\n`, 2)
    }
    const outcome = await performFetch(target.href, {
      method,
      headers,
      body: data,
      maxTime,
      signal: ctx.signal,
    })
    if (!outcome.ok) {
      if (outcome.reason === 'aborted') {
        return { code: 130, stderr: 'curl: 已中断\n' }
      }
      if (outcome.reason === 'timeout') {
        return fail(`curl: 请求超时（--max-time ${maxTime ?? 0} 秒）\n`, 28)
      }
      return fail(`curl: 请求失败（可能是 CORS 限制）：${outcome.detail}\n`, 6)
    }
    const response = outcome.response
    const writeOutText = writeOut === null ? '' : formatWriteOut(writeOut, response, outcome.bytes)
    if (response.status < 200 || response.status >= 300) {
      return { code: 22, stdout: writeOutText, stderr: `curl: ${statusText(response)}\n` }
    }
    const outputPath = output !== null ? output : remoteName ? remoteFileName(target) : null
    let stdout = ''
    if (headOnly) {
      const text = headersText(response)
      if (outputPath !== null) {
        const targetPath = resolvePath(ctx.cwd, outputPath)
        const error = saveFile(ctx, targetPath, encoder.encode(text))
        if (error) {
          return fail(`curl: ${outputPath}: ${error}\n`, 23)
        }
        if (!silent) {
          stdout += `curl: 已保存到 '${targetPath}'\n`
        }
      } else {
        stdout += text
      }
      stdout += writeOutText
      return { code: 0, stdout }
    }
    if (outputPath !== null) {
      const targetPath = resolvePath(ctx.cwd, outputPath)
      const error = saveFile(ctx, targetPath, outcome.bytes)
      if (error) {
        return fail(`curl: ${outputPath}: ${error}\n`, 23)
      }
      if (!silent) {
        stdout += `curl: 已保存到 '${targetPath}'\n`
      }
      stdout += writeOutText
      return { code: 0, stdout }
    }
    const text = decodeText(outcome.bytes)
    if (text === null || hasNul(outcome.bytes)) {
      return fail(
        `curl: 响应是${BINARY_HINT}（${outcome.bytes.byteLength} 字节），请用 -o FILE 落文件\n`
      )
    }
    stdout += withNewline(text)
    stdout += writeOutText
    return { code: 0, stdout }
  },
}

// ---------- wget ----------

const wgetUsage = 'wget [-q] [-O FILE] [-P DIR] URL'

const wgetSpec: FlagSpec = {
  q: 'boolean',
  O: 'value',
  P: 'value',
  quiet: 'boolean',
  'no-verbose': 'boolean',
  'output-document': 'value',
  'directory-prefix': 'value',
}

/** wget：默认把响应体存成 URL 末段文件名，-q 静默，-P 指定目录 */
const wgetApplet: Applet = {
  name: 'wget',
  summary: '下载文件：默认存成 URL 末段名，-O 指定文件、-P 指定目录、-q 安静',
  summaryEn: 'Download a URL to a file with -O/-P/-q',
  usage: wgetUsage,
  run: async (ctx: AppletContext): Promise<AppletResult> => {
    if (wantsHelp(ctx.argv)) {
      return ok(`${wgetUsage}\n`)
    }
    const parsed = parseArgs(ctx.argv, wgetSpec)
    if (parsed.error) {
      return fail(`wget: ${parsed.error}\n`, 2)
    }
    if (interrupted(ctx)) {
      return { code: 130, stderr: 'wget: interrupted\n' }
    }
    const operands = parsed.operands
    if (operands.length === 0) {
      return fail('wget: 缺少 URL\n', 2)
    }
    if (operands.length > 1) {
      return fail(`wget: 一次只能下载一个 URL（多余：${operands.slice(1).join(' ')}）\n`, 2)
    }
    const target = parseUrl(normalizeUrl(operands[0]))
    if (!target) {
      return fail(`wget: 无效的 URL '${operands[0]}'\n`, 1)
    }
    const quiet = flagOn(parsed.flags, 'q', 'quiet', 'no-verbose')
    const outputDocument = flagText(parsed.flags, 'O', 'output-document')
    const prefix = flagText(parsed.flags, 'P', 'directory-prefix')
    if (outputDocument === '') {
      return fail('wget: -O 需要一个文件名\n', 2)
    }
    const outcome = await performFetch(target.href, {
      method: 'GET',
      headers: new Headers(),
      body: null,
      maxTime: null,
      signal: ctx.signal,
    })
    if (!outcome.ok) {
      if (outcome.reason === 'aborted') {
        return { code: 130, stderr: 'wget: 已中断\n' }
      }
      if (outcome.reason === 'timeout') {
        return fail('wget: 请求超时\n', 4)
      }
      return fail(`wget: 请求失败（可能是 CORS 限制）：${outcome.detail}\n`, 4)
    }
    const response = outcome.response
    if (response.status < 200 || response.status >= 300) {
      return { code: 8, stderr: `wget: ${statusText(response)}\n` }
    }
    if (outputDocument === '-') {
      const text = decodeText(outcome.bytes)
      if (text === null || hasNul(outcome.bytes)) {
        return fail(
          `wget: 响应是${BINARY_HINT}（${outcome.bytes.byteLength} 字节），请用 -O FILE 落文件\n`
        )
      }
      return { code: 0, stdout: withNewline(text) }
    }
    const targetPath =
      outputDocument !== null
        ? resolvePath(ctx.cwd, outputDocument)
        : resolvePath(
            prefix === null ? ctx.cwd : resolvePath(ctx.cwd, prefix),
            remoteFileName(target)
          )
    const error = saveFile(ctx, targetPath, outcome.bytes)
    if (error) {
      return fail(`wget: '${targetPath}': ${error}\n`, 1)
    }
    return { code: 0, stdout: quiet ? '' : `saving to '${targetPath}'\n` }
  },
}

/** 网络类命令 */
export const NET_APPLETS: Applet[] = [curlApplet, wgetApplet]
