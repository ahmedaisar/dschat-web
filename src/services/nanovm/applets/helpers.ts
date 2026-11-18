import { ERRNO_TEXT, VmError, type AppletContext, type AppletResult } from '../types.js'
import { resolvePath } from '../fs.js'

/**
 * 应用集（busybox 程序）共用的参数解析与输出工具。
 *
 * 参数风格尽量贴近 busybox：短选项可以合并（`ls -la`），带值的选项可以紧贴（`head -n5`），
 * 也接受 `--long` / `--long=value` 与 `--` 终止符。未知选项返回错误而不是静默忽略——
 * 这样 `grep -E` 这种还没实现的用法会明确提示，而不是给出错误结果。
 */

export type FlagValue = string | true
export type FlagSpec = Record<string, 'boolean' | 'value'>

export type ParsedArgs = {
  flags: Record<string, FlagValue>
  operands: string[]
  /** 第一个未知选项或缺少值时的错误文案 */
  error?: string
}

/** 解析参数；spec 的键是不带前缀的名字（`r` 或 `recursive`） */
export const parseArgs = (argv: string[], spec: FlagSpec): ParsedArgs => {
  const flags: Record<string, FlagValue> = {}
  const operands: string[] = []
  const rest = argv.slice(1)
  let terminated = false
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]
    if (terminated || arg === '-' || !arg.startsWith('-')) {
      operands.push(arg)
      continue
    }
    if (arg === '--') {
      terminated = true
      continue
    }
    if (arg.startsWith('--')) {
      const body = arg.slice(2)
      const equals = body.indexOf('=')
      const name = equals >= 0 ? body.slice(0, equals) : body
      const kind = spec[name]
      if (!kind) {
        return { flags, operands, error: `unrecognized option '--${name}'` }
      }
      if (kind === 'boolean') {
        flags[name] = true
      } else if (equals >= 0) {
        flags[name] = body.slice(equals + 1)
      } else {
        const value = rest[index + 1]
        if (value === undefined) {
          return { flags, operands, error: `option '--${name}' requires an argument` }
        }
        flags[name] = value
        index += 1
      }
      continue
    }
    const body = arg.slice(1)
    for (let position = 0; position < body.length; position += 1) {
      const name = body[position]
      const kind = spec[name]
      if (!kind) {
        return { flags, operands, error: `invalid option -- '${name}'` }
      }
      if (kind === 'boolean') {
        flags[name] = true
        continue
      }
      const inline = body.slice(position + 1)
      if (inline) {
        flags[name] = inline
      } else {
        const value = rest[index + 1]
        if (value === undefined) {
          return { flags, operands, error: `option requires an argument -- '${name}'` }
        }
        flags[name] = value
        index += 1
      }
      break
    }
  }
  return { flags, operands }
}

/** 输出成功结果 */
export const ok = (stdout = ''): AppletResult => ({ code: 0, stdout })

/** 输出失败结果：标准错误 + 退出码 1 */
export const fail = (stderr: string, code = 1): AppletResult => ({ code, stderr })

/** 缺少工具链：交给 UI 提示安装 */
export const needToolchain = (
  install: NonNullable<AppletResult['install']>,
  stderr: string
): AppletResult => ({ code: 127, stderr, install })

/** 把 VmError 翻译成 `ls: cannot access 'x': No such file or directory` */
export const vmErrorMessage = (command: string, error: unknown, operand?: string): AppletResult => {
  if (error instanceof VmError) {
    const text = error.message
    // fs 的说明已经带「cannot ... '路径'」时直接拼命令名，避免重复路径
    if (/^(cannot|invalid|-r not)/.test(text)) {
      return { code: 1, stderr: `${command}: ${text}\n` }
    }
    const target = operand ? `${operand}: ` : ''
    return { code: 1, stderr: `${command}: ${target}${text}\n` }
  }
  const message = error instanceof Error ? error.message : String(error)
  return { code: 1, stderr: `${command}: ${message}\n` }
}

/** 文本按行切分，去掉末尾的空行 */
export const splitLines = (text: string): string[] => {
  const lines = text.split('\n')
  if (lines.at(-1) === '') {
    lines.pop()
  }
  return lines
}

/** 行数组拼回文本，每行都带换行 */
export const joinLines = (lines: string[]): string => (lines.length ? `${lines.join('\n')}\n` : '')

/** 按 -n <num> / -c <num> 的取值范围取头尾 */
export const sliceCount = (lines: string[], count: number, fromEnd: boolean): string[] =>
  fromEnd ? lines.slice(Math.max(0, lines.length - count)) : lines.slice(0, Math.max(0, count))

/** 人类可读的字节数：1.5M、512、3.2G */
export const humanSize = (bytes: number): string => {
  if (bytes < 1024) {
    return String(bytes)
  }
  const units = ['K', 'M', 'G', 'T']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  const rounded = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10
  return `${rounded}${units[unit]}`
}

/** `ls -l` 风格的时间：2026-11-18 22:34 */
export const stamp = (time: number): string => {
  const date = new Date(time)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 权限位转 rwxr-xr-x */
export const modeText = (mode: number, kind: 'file' | 'dir'): string => {
  const chars = ['r', 'w', 'x']
  let text = kind === 'dir' ? 'd' : '-'
  for (let shift = 6; shift >= 0; shift -= 3) {
    for (let bit = 0; bit < 3; bit += 1) {
      text += mode & (1 << (shift + 2 - bit)) ? chars[bit] : '-'
    }
  }
  return text
}

/** 解析 755 / u+x 这类权限写法 */
export const parseMode = (text: string): number | null => {
  if (/^[0-7]{3,4}$/.test(text)) {
    return Number.parseInt(text, 8)
  }
  return null
}

/** 展开参数里的通配符；没有命中时保留原样，符合 shell 习惯 */
export const expandPaths = (
  words: string[],
  context: { cwd: string; env: Record<string, string> },
  fs: AppletContext['fs']
): string[] => {
  const out: string[] = []
  for (const word of words) {
    if (!/[*?[]/.test(word)) {
      out.push(resolvePath(context.cwd, word))
      continue
    }
    const matches = fs.glob(resolvePath(context.cwd, word))
    if (matches.length === 0) {
      out.push(resolvePath(context.cwd, word))
    } else {
      out.push(...matches)
    }
  }
  return out
}

/** 读取文件内容；`-` 表示标准输入 */
export const readInputBytes = (ctx: AppletContext, path: string): Uint8Array => {
  if (path === '-' || (!path && ctx.stdin)) {
    return new TextEncoder().encode(ctx.stdin)
  }
  const bytes = ctx.fs.read(resolvePath(ctx.cwd, path))
  if (!bytes) {
    throw new VmError('ENOENT', ERRNO_TEXT.ENOENT)
  }
  return bytes
}

/** 读取文本；多个文件按顺序拼接 */
export const readInputText = (ctx: AppletContext, paths: string[]): string => {
  if (paths.length === 0) {
    return ctx.stdin
  }
  const decoder = new TextDecoder()
  return paths
    .map((path) => (path === '-' ? ctx.stdin : decoder.decode(readInputBytes(ctx, path))))
    .join('')
}

/** 把结果按 `-o` / stdin 的约定写回：这里统一走返回值的 stdout */
export const output = (text: string): AppletResult => ({ code: 0, stdout: text })

/** 检查是否被中断或超时 */
export const interrupted = (ctx: AppletContext): boolean =>
  ctx.signal?.aborted === true || Date.now() > ctx.deadline
