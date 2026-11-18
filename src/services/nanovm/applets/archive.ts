import { gunzipSync, gzipSync } from 'fflate'
import type { Applet, AppletContext, AppletResult } from '../types.js'
import { VmError } from '../types.js'
import { dirName, normalizePath, resolvePath } from '../fs.js'
import {
  expandPaths,
  fail,
  interrupted,
  modeText,
  ok,
  parseArgs,
  readInputBytes,
  stamp,
  type FlagSpec,
  type ParsedArgs,
} from './helpers.js'

/**
 * 归档与校验命令（tar / gzip / gunzip / sha256sum / sha1sum / md5sum / base64 / cksum / diff）。
 *
 * tar 的 ustar 读写是自己实现的，不引第三方库；gzip 走 fflate。校验和优先用
 * crypto.subtle，浏览器普遍不给 MD5 时回落到自带的纯 JS 实现。所有二进制都在
 * Uint8Array 上处理，不经过字符串——终端只有文本通道，压缩结果这类二进制只能落文件。
 */

const encoder = new TextEncoder()

/** 终端是文本通道：二进制结果不往 stdout 倒，避免显示成乱码 */
const BINARY_HINT = '二进制数据无法写入文本终端'

const wantsHelp = (argv: string[]): boolean =>
  argv.length === 2 && (argv[1] === '--help' || argv[1] === '-h')

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

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

/** 严格 UTF-8 解码：失败返回 null，调用方据此判断二进制 */
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

/** 文本输出统一补一个结尾换行（二进制内容原样保留，见 gzip -c） */
const withNewline = (text: string): string =>
  text === '' || text.endsWith('\n') ? text : `${text}\n`

const concatBytes = (chunks: Uint8Array[]): Uint8Array => {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

// ---------- gzip / gunzip ----------

const gzipUsage = 'gzip [-cdkf] [file...]｜gzip x → x.gz，gzip -d x.gz → x'

/** x.gz → x、x.tgz → x.tar；后缀不认识时返回 null（GNU 会报 unknown suffix） */
const decompressedName = (file: string): string | null => {
  if (file.endsWith('.tgz') || file.endsWith('.taz')) {
    return `${file.slice(0, -4)}.tar`
  }
  if (file.endsWith('.gz')) {
    return file.slice(0, -3)
  }
  return null
}

/**
 * gzip / gunzip 共用的实现。
 *
 * 压缩结果一定是二进制，`-c` 只对解压出的文本有意义；压缩时用 `-c` 会明确提示
 * 改用文件模式（生成 x.gz），不会往终端里灌乱码。
 */
const runGzip = (ctx: AppletContext, decompress: boolean): AppletResult => {
  const usage = decompress ? 'gunzip [-ckf] [file...]' : gzipUsage
  if (wantsHelp(ctx.argv)) {
    return ok(`${usage}\n`)
  }
  const parsed = parseArgs(ctx.argv, { c: 'boolean', d: 'boolean', k: 'boolean', f: 'boolean' })
  if (parsed.error) {
    return fail(`${decompress ? 'gunzip' : 'gzip'}: ${parsed.error}\n`)
  }
  const command = decompress ? 'gunzip' : 'gzip'
  // gzip -d 等价 gunzip；gunzip 自身永远是解压
  const unzip = decompress || flagOn(parsed.flags, 'd')
  const toStdout = flagOn(parsed.flags, 'c')
  const keep = flagOn(parsed.flags, 'k')
  const force = flagOn(parsed.flags, 'f')
  const files = parsed.operands
  if (files.length === 0) {
    return fail(`${command}: 缺少文件名：终端只有文本通道，请用文件形式（如 gzip x 生成 x.gz）\n`)
  }
  const messages: string[] = []
  let stdout = ''
  let code = 0
  for (const file of files) {
    if (interrupted(ctx)) {
      return { code: 130, stderr: `${messages.join('')}${command}: interrupted\n` }
    }
    const source = resolvePath(ctx.cwd, file)
    let bytes: Uint8Array | null = null
    try {
      bytes = ctx.fs.read(source)
    } catch (error) {
      messages.push(`${command}: ${file}: ${describeError(error)}\n`)
      code = 1
      continue
    }
    if (!bytes) {
      messages.push(`${command}: ${file}: No such file or directory\n`)
      code = 1
      continue
    }
    let result: Uint8Array
    try {
      result = unzip ? gunzipSync(bytes) : gzipSync(bytes, { level: 6 })
    } catch {
      messages.push(`${command}: ${file}: ${unzip ? '不是有效的 gzip 数据' : '压缩失败'}\n`)
      code = 1
      continue
    }
    if (toStdout) {
      if (!unzip) {
        messages.push(
          `${command}: ${file}: ${BINARY_HINT}；请去掉 -c，用 gzip ${file} 生成 ${file}.gz\n`
        )
        code = 1
        continue
      }
      const text = decodeText(result)
      if (text === null) {
        messages.push(`${command}: ${file}: 解压结果是${BINARY_HINT}，请解压到文件后查看\n`)
        code = 1
        continue
      }
      stdout += text
      continue
    }
    let target: string
    if (unzip) {
      const name = decompressedName(file)
      if (name === null) {
        messages.push(`${command}: ${file}: unknown suffix -- ignored\n`)
        code = 1
        continue
      }
      target = name
    } else {
      if (source.endsWith('.gz')) {
        messages.push(`${command}: ${file}: 已有 .gz 后缀，跳过\n`)
        code = 1
        continue
      }
      target = `${file}.gz`
    }
    const targetPath = resolvePath(ctx.cwd, target)
    if (targetPath !== source && ctx.fs.exists(targetPath) && !force) {
      messages.push(`${command}: ${target}: already exists; not overwritten（加 -f 覆盖）\n`)
      code = 1
      continue
    }
    try {
      ctx.fs.write(targetPath, result)
    } catch (error) {
      messages.push(`${command}: ${target}: ${describeError(error)}\n`)
      code = 1
      continue
    }
    // 与 GNU 一致：默认删掉源文件，-k 保留
    if (!keep && targetPath !== source) {
      try {
        ctx.fs.remove(source)
      } catch {
        // 删除失败不影响已经写好的结果
      }
    }
  }
  return { code, stdout, stderr: messages.join('') }
}

const gzipApplet: Applet = {
  name: 'gzip',
  summary: 'gzip 压缩文件，-d 解压，-k 保留源文件（压缩结果只写文件）',
  summaryEn: 'Compress files with gzip; -d decompresses, -k keeps the source',
  usage: gzipUsage,
  run: (ctx: AppletContext): AppletResult => runGzip(ctx, false),
}

const gunzipApplet: Applet = {
  name: 'gunzip',
  summary: '解压 .gz 文件（等价 gzip -d）',
  summaryEn: 'Decompress gzip files (same as gzip -d)',
  usage: 'gunzip [-ckf] [file...]',
  run: (ctx: AppletContext): AppletResult => runGzip(ctx, true),
}

// ---------- tar（自己实现的 ustar） ----------

const BLOCK = 512
const MAX_NAME = 100
const MAX_PREFIX = 155

type TarEntry = {
  /** 归档里的相对路径（不带开头的 /） */
  name: string
  kind: 'file' | 'dir'
  bytes: Uint8Array
  mtime: number
  mode: number
}

type ParsedEntry = {
  name: string
  kind: 'file' | 'dir' | 'other'
  bytes: Uint8Array
  mtime: number
  mode: number
}

/** 数值写成八进制：宽度里留一位给结尾的 NUL */
const octal = (value: number, width: number): string => {
  const text = value.toString(8)
  if (text.length > width - 1) {
    throw new VmError('EINVAL', '字段超出 tar 头部宽度')
  }
  return `${text.padStart(width - 1, '0')}\0`
}

const writeField = (block: Uint8Array, offset: number, text: string, length: number) => {
  const bytes = encoder.encode(text)
  block.set(bytes.subarray(0, length), offset)
}

/** ustar 的 name 最多 100 字节，长路径拆成 prefix + name；拆不开返回 null */
const splitTarName = (name: string): { name: string; prefix: string } | null => {
  if (encoder.encode(name).length <= MAX_NAME) {
    return { name, prefix: '' }
  }
  for (let index = name.length - 1; index > 0; index -= 1) {
    if (name[index] !== '/') {
      continue
    }
    const prefix = name.slice(0, index)
    const rest = name.slice(index + 1)
    if (
      rest.length > 0 &&
      encoder.encode(prefix).length <= MAX_PREFIX &&
      encoder.encode(rest).length <= MAX_NAME
    ) {
      return { name: rest, prefix }
    }
  }
  return null
}

const fitsTarName = (name: string): boolean => splitTarName(name) !== null

/**
 * 操作数在归档里的名字。
 *
 * 绝对操作数去掉开头的 /（GNU 的「Removing leading /」）；相对操作数保留相对
 * `-C` 目录的路径，于是 `tar -C dir -cf x.tar file` 里存成 file，与 GNU 一致。
 */
const archiveOperandName = (operand: string, baseCwd: string, absolute: string): string => {
  if (!operand.startsWith('/')) {
    // '.' 表示把当前目录本身打到归档根
    if (absolute === baseCwd) {
      return '.'
    }
    if (baseCwd === '/' && absolute !== '/') {
      return absolute.slice(1)
    }
    if (absolute.startsWith(`${baseCwd}/`)) {
      return absolute.slice(baseCwd.length + 1)
    }
  }
  return absolute === '/' ? '' : absolute.replace(/^\/+/, '')
}

/** 一个 512 字节的 ustar 头；typeflag 只有普通文件 0 与目录 5 */
/** ustar 的约定：目录成员名字带结尾的 / */
const tarMemberName = (entry: TarEntry): string =>
  entry.kind === 'dir' ? `${entry.name.replace(/\/+$/, '')}/` : entry.name

const tarHeader = (entry: TarEntry): Uint8Array => {
  const memberName = tarMemberName(entry)
  const stored = splitTarName(memberName)
  if (!stored) {
    throw new VmError('EINVAL', `路径过长，无法写入 ustar 头：${memberName}`)
  }
  const block = new Uint8Array(BLOCK)
  writeField(block, 0, stored.name, MAX_NAME)
  writeField(block, 100, octal(entry.mode & 0o7777, 8), 8)
  writeField(block, 108, octal(0, 8), 8)
  writeField(block, 116, octal(0, 8), 8)
  writeField(block, 124, octal(entry.kind === 'file' ? entry.bytes.byteLength : 0, 12), 12)
  writeField(block, 136, octal(Math.floor(entry.mtime / 1000), 12), 12)
  // 校验和字段先按 8 个空格参与计算
  block.fill(0x20, 148, 156)
  block[156] = entry.kind === 'dir' ? 0x35 : 0x30
  writeField(block, 257, 'ustar', 6)
  writeField(block, 263, '00', 2)
  writeField(block, 265, 'user', 32)
  writeField(block, 297, 'user', 32)
  if (stored.prefix) {
    writeField(block, 345, stored.prefix, MAX_PREFIX)
  }
  let sum = 0
  for (const byte of block) {
    sum += byte
  }
  writeField(block, 148, `${octal(sum, 7)} `, 8)
  return block
}

const padToBlock = (length: number): number => (BLOCK - (length % BLOCK)) % BLOCK

const buildTar = (entries: TarEntry[]): Uint8Array => {
  const chunks: Uint8Array[] = []
  for (const entry of entries) {
    chunks.push(tarHeader(entry))
    if (entry.kind === 'file' && entry.bytes.byteLength > 0) {
      chunks.push(entry.bytes)
      const padding = padToBlock(entry.bytes.byteLength)
      if (padding > 0) {
        chunks.push(new Uint8Array(padding))
      }
    }
  }
  // 归档结束标记：两个全零块
  chunks.push(new Uint8Array(BLOCK * 2))
  return concatBytes(chunks)
}

const isZeroBlock = (block: Uint8Array): boolean => {
  for (const byte of block) {
    if (byte !== 0) {
      return false
    }
  }
  return true
}

const readField = (block: Uint8Array, offset: number, length: number): string => {
  let end = offset
  const limit = offset + length
  while (end < limit && block[end] !== 0) {
    end += 1
  }
  return new TextDecoder().decode(block.subarray(offset, end))
}

const readOctal = (block: Uint8Array, offset: number, length: number): number | null => {
  let text = ''
  for (let index = offset; index < offset + length; index += 1) {
    const byte = block[index]
    if (byte === 0 || byte === 0x20) {
      if (text.length > 0) {
        break
      }
      continue
    }
    if (byte < 0x30 || byte > 0x37) {
      return null
    }
    text += String.fromCharCode(byte)
  }
  return text.length > 0 ? Number.parseInt(text, 8) : 0
}

/** 头部里的数字：优先八进制，兼容 GNU 的 base-256 扩展 */
const readTarNumber = (block: Uint8Array, offset: number, length: number): number => {
  if ((block[offset] & 0x80) !== 0) {
    let value = block[offset] & 0x7f
    for (let index = offset + 1; index < offset + length; index += 1) {
      value = value * 256 + block[index]
    }
    return value
  }
  return readOctal(block, offset, length) ?? 0
}

/** 校验和：无符号与有符号两种写法都接受 */
const blockChecksum = (block: Uint8Array): { unsigned: number; signed: number } => {
  let unsigned = 0
  let signed = 0
  for (let index = 0; index < BLOCK; index += 1) {
    const byte = index >= 148 && index < 156 ? 0x20 : block[index]
    unsigned += byte
    signed += byte > 127 ? byte - 256 : byte
  }
  return { unsigned, signed }
}

const parseTar = (data: Uint8Array): ParsedEntry[] => {
  const entries: ParsedEntry[] = []
  let offset = 0
  while (offset + BLOCK <= data.length) {
    const block = data.subarray(offset, offset + BLOCK)
    if (isZeroBlock(block)) {
      break
    }
    const expected = readOctal(block, 148, 8)
    const sum = blockChecksum(block)
    if (expected !== null && expected !== sum.unsigned && expected !== sum.signed) {
      throw new VmError('EINVAL', `头部校验和不匹配（偏移 ${offset}），归档可能损坏`)
    }
    const prefix = readField(block, 345, MAX_PREFIX)
    const base = readField(block, 0, MAX_NAME)
    const name = prefix ? `${prefix}/${base}` : base
    const typeflag = block[156]
    const size = readTarNumber(block, 124, 12)
    const mode = readTarNumber(block, 100, 8) & 0o7777
    const mtime = readTarNumber(block, 136, 12) * 1000
    const kind: ParsedEntry['kind'] =
      typeflag === 0x35
        ? 'dir'
        : typeflag === 0x30 || typeflag === 0 || typeflag === 0x37
          ? 'file'
          : 'other'
    const dataStart = offset + BLOCK
    const dataSize = kind === 'dir' ? 0 : size
    if (dataStart + dataSize > data.length) {
      throw new VmError('EINVAL', `归档被截断（成员 '${name}'）`)
    }
    entries.push({
      name,
      kind,
      bytes: data.subarray(dataStart, dataStart + dataSize),
      mtime,
      mode,
    })
    offset = dataStart + Math.ceil(dataSize / BLOCK) * BLOCK
  }
  return entries
}

/** 解包时的路径安全：跳过绝对路径与 ..，返回归档内的相对路径 */
const safeRelativeName = (name: string): string | null => {
  const parts = name.replace(/^\/+/, '').split('/')
  const safe: string[] = []
  for (const part of parts) {
    if (part === '' || part === '.') {
      continue
    }
    if (part === '..') {
      return null
    }
    safe.push(part)
  }
  return safe.length > 0 ? safe.join('/') : null
}

const memberMatcher = (names: string[]): ((name: string) => boolean) => {
  if (names.length === 0) {
    return () => true
  }
  const wanted = names.map((name) =>
    name.replace(/^\.\//, '').replace(/^\/+/, '').replace(/\/+$/, '')
  )
  return (name) => {
    const target = name.replace(/\/+$/, '')
    return wanted.some((item) => target === item || target.startsWith(`${item}/`))
  }
}

const readArchiveBytes = (
  ctx: AppletContext,
  archivePath: string,
  label: string,
  gzipFlag: boolean
): Uint8Array => {
  const bytes = ctx.fs.read(archivePath)
  if (!bytes) {
    throw new VmError('ENOENT', `cannot open '${label}': No such file or directory`)
  }
  // -z 或文件自带 gzip 魔数时自动解压，方便直接读 x.tgz
  const gzipped = bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b
  if (gzipFlag || gzipped) {
    try {
      return gunzipSync(bytes)
    } catch {
      throw new VmError('EINVAL', `'${label}' 不是有效的 gzip 归档`)
    }
  }
  return bytes
}

type CreateOptions = {
  archivePath: string
  archive: string
  files: string[]
  directory: string | null
  verbose: boolean
  gzipFlag: boolean
}

const createArchive = (ctx: AppletContext, options: CreateOptions): AppletResult => {
  if (options.files.length === 0) {
    return fail('tar: 没有指定要打包的文件\n', 2)
  }
  const baseCwd = options.directory === null ? ctx.cwd : resolvePath(ctx.cwd, options.directory)
  const entries: TarEntry[] = []
  const messages: string[] = []
  let code = 0
  const add = (entry: TarEntry) => {
    if (!fitsTarName(tarMemberName(entry))) {
      messages.push(`tar: 路径过长，跳过 '${entry.name}'\n`)
      code = 1
      return
    }
    entries.push(entry)
    if (options.verbose) {
      messages.push(`${entry.kind === 'dir' ? `${entry.name}/` : entry.name}\n`)
    }
  }
  for (const operand of options.files) {
    if (interrupted(ctx)) {
      return { code: 130, stderr: `${messages.join('')}tar: interrupted\n` }
    }
    const [absolute] = expandPaths([operand], { cwd: baseCwd, env: ctx.env }, ctx.fs)
    if (absolute === undefined || absolute === options.archivePath) {
      continue
    }
    const stat = ctx.fs.stat(absolute)
    if (!stat) {
      messages.push(`tar: ${operand}: No such file or directory\n`)
      code = 1
      continue
    }
    const operandName = archiveOperandName(operand, baseCwd, absolute)
    if (operandName === '') {
      continue
    }
    // '.' 表示把目录内容直接放到归档根，成员不再带 ./ 前缀
    const prefix = operandName === '.' ? '' : operandName
    if (stat.kind === 'dir') {
      if (prefix !== '') {
        add({
          name: prefix,
          kind: 'dir',
          bytes: new Uint8Array(0),
          mtime: stat.mtime,
          mode: stat.mode,
        })
      }
      for (const child of ctx.fs.walk(absolute)) {
        if (interrupted(ctx)) {
          return { code: 130, stderr: `${messages.join('')}tar: interrupted\n` }
        }
        if (child.path === options.archivePath) {
          continue
        }
        const relative =
          absolute === '/' ? child.path.slice(1) : child.path.slice(absolute.length + 1)
        if (relative === '') {
          continue
        }
        const childName = prefix === '' ? relative : `${prefix}/${relative}`
        if (child.kind === 'dir') {
          add({
            name: childName,
            kind: 'dir',
            bytes: new Uint8Array(0),
            mtime: child.mtime,
            mode: child.mode,
          })
          continue
        }
        const bytes = ctx.fs.read(child.path)
        if (!bytes) {
          continue
        }
        add({
          name: childName,
          kind: 'file',
          bytes,
          mtime: child.mtime,
          mode: child.mode,
        })
      }
      continue
    }
    const bytes = ctx.fs.read(absolute)
    if (!bytes) {
      messages.push(`tar: ${operand}: No such file or directory\n`)
      code = 1
      continue
    }
    add({ name: prefix, kind: 'file', bytes, mtime: stat.mtime, mode: stat.mode })
  }
  const raw = buildTar(entries)
  const data = options.gzipFlag ? gzipSync(raw, { level: 6 }) : raw
  try {
    ctx.fs.write(options.archivePath, data)
  } catch (error) {
    return {
      code: 1,
      stderr: `${messages.join('')}tar: ${options.archive}: ${describeError(error)}\n`,
    }
  }
  return { code, stderr: messages.join('') }
}

const extractArchive = (
  ctx: AppletContext,
  entries: ParsedEntry[],
  destDir: string,
  verbose: boolean,
  match: (name: string) => boolean
): AppletResult => {
  const messages: string[] = []
  let code = 0
  try {
    ctx.fs.mkdir(destDir, true)
  } catch (error) {
    return { code: 2, stderr: `tar: ${destDir}: ${describeError(error)}\n` }
  }
  for (const entry of entries) {
    if (interrupted(ctx)) {
      return { code: 130, stderr: `${messages.join('')}tar: interrupted\n` }
    }
    if (!match(entry.name)) {
      continue
    }
    if (entry.kind === 'other') {
      messages.push(`tar: 跳过不支持的成员 '${entry.name}'\n`)
      continue
    }
    const relative = safeRelativeName(entry.name)
    if (relative === null) {
      messages.push(`tar: 跳过不安全的路径 '${entry.name}'\n`)
      code = 1
      continue
    }
    const target = normalizePath(`${destDir}/${relative}`)
    try {
      if (entry.kind === 'dir') {
        ctx.fs.mkdir(target, true)
        if (entry.mode > 0) {
          try {
            ctx.fs.chmod(target, entry.mode & 0o7777)
          } catch {
            // 权限位设置失败不影响解包
          }
        }
      } else {
        ctx.fs.mkdir(dirName(target), true)
        ctx.fs.write(target, entry.bytes, { mode: entry.mode > 0 ? entry.mode & 0o7777 : 0o644 })
      }
    } catch (error) {
      messages.push(`tar: ${entry.name}: ${describeError(error)}\n`)
      code = 1
      continue
    }
    if (verbose) {
      messages.push(`${entry.name}\n`)
    }
  }
  return { code, stderr: messages.join('') }
}

const listEntries = (
  entries: ParsedEntry[],
  verbose: boolean,
  match: (name: string) => boolean
): string => {
  const lines: string[] = []
  for (const entry of entries) {
    if (!match(entry.name)) {
      continue
    }
    if (!verbose) {
      lines.push(`${entry.name}\n`)
      continue
    }
    const kind = entry.kind === 'dir' ? 'dir' : 'file'
    const mode = modeText(entry.mode || (kind === 'dir' ? 0o755 : 0o644), kind)
    const size = String(entry.bytes.byteLength).padStart(8)
    lines.push(`${mode} user/user ${size} ${stamp(entry.mtime)} ${entry.name}\n`)
  }
  return lines.join('')
}

/** 老式写法 `tar cf x.tar dir`：把第一个参数当成选项字母 */
const tarArgv = (argv: string[]): string[] => {
  const first = argv[1]
  if (first && !first.startsWith('-') && /^[cxtvzfC]+$/.test(first)) {
    return [argv[0], `-${first}`, ...argv.slice(2)]
  }
  return argv
}

const tarSpec: FlagSpec = {
  c: 'boolean',
  x: 'boolean',
  t: 'boolean',
  v: 'boolean',
  z: 'boolean',
  f: 'value',
  C: 'value',
  create: 'boolean',
  extract: 'boolean',
  list: 'boolean',
  verbose: 'boolean',
  gzip: 'boolean',
  file: 'value',
  directory: 'value',
}

const tarUsage =
  'tar -c|-x|-t [-vz] -f ARCHIVE [-C DIR] [file...]｜tar -cf x.tar dir、tar -xzf x.tgz -C dir'

const tarApplet: Applet = {
  name: 'tar',
  summary: '打包 / 解包 ustar 归档，-z 走 gzip，-t 查看内容',
  summaryEn: 'Create, list or extract ustar archives; -z uses gzip',
  usage: tarUsage,
  run: (ctx: AppletContext): AppletResult => {
    if (wantsHelp(ctx.argv)) {
      return ok(`${tarUsage}\n`)
    }
    const parsed = parseArgs(tarArgv(ctx.argv), tarSpec)
    if (parsed.error) {
      return fail(`tar: ${parsed.error}\n`, 2)
    }
    const create = flagOn(parsed.flags, 'c', 'create')
    const extract = flagOn(parsed.flags, 'x', 'extract')
    const list = flagOn(parsed.flags, 't', 'list')
    const verbose = flagOn(parsed.flags, 'v', 'verbose')
    const gzipFlag = flagOn(parsed.flags, 'z', 'gzip')
    const modes = [create, extract, list].filter(Boolean).length
    if (modes !== 1) {
      return fail('tar: 必须且只能指定 -c / -x / -t 之一\n', 2)
    }
    const archive = flagText(parsed.flags, 'f', 'file')
    if (archive === null) {
      return fail('tar: 必须用 -f 指定归档文件（终端没有磁带设备）\n', 2)
    }
    const directory = flagText(parsed.flags, 'C', 'directory')
    const archivePath = resolvePath(ctx.cwd, archive)
    try {
      if (create) {
        return createArchive(ctx, {
          archivePath,
          archive,
          files: parsed.operands,
          directory,
          verbose,
          gzipFlag,
        })
      }
      const raw = readArchiveBytes(ctx, archivePath, archive, gzipFlag)
      const entries = parseTar(raw)
      const match = memberMatcher(parsed.operands)
      if (list) {
        return { code: 0, stdout: listEntries(entries, verbose, match) }
      }
      const destDir = directory === null ? ctx.cwd : resolvePath(ctx.cwd, directory)
      return extractArchive(ctx, entries, destDir, verbose, match)
    } catch (error) {
      return fail(`tar: ${describeError(error)}\n`, 2)
    }
  },
}

// ---------- 校验和（sha256sum / sha1sum / md5sum） ----------

type DigestAlgorithm = 'SHA-256' | 'SHA-1' | 'MD5'

const HEX_TABLE: string[] = []
for (let index = 0; index < 256; index += 1) {
  HEX_TABLE.push(index.toString(16).padStart(2, '0'))
}

const toHex = (bytes: Uint8Array): string => {
  let text = ''
  for (const byte of bytes) {
    text += HEX_TABLE[byte]
  }
  return text
}

/** 纯 JS MD5：WebCrypto 普遍不支持 MD5，必须自带一个保证命令可用 */
const md5Hex = (bytes: Uint8Array): string => {
  const length = bytes.length
  const bitLength = length * 8
  const total = (((length + 8) >> 6) + 1) << 6
  const buffer = new Uint8Array(total)
  buffer.set(bytes)
  buffer[length] = 0x80
  const view = new DataView(buffer.buffer)
  view.setUint32(total - 8, bitLength >>> 0, true)
  view.setUint32(total - 4, Math.floor(bitLength / 0x100000000), true)

  const shifts = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9,
    14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ]
  const constants: number[] = []
  for (let index = 0; index < 64; index += 1) {
    constants.push(Math.floor(Math.abs(Math.sin(index + 1)) * 0x100000000) | 0)
  }

  let a0 = 0x67452301
  let b0 = 0xefcdab89 | 0
  let c0 = 0x98badcfe | 0
  let d0 = 0x10325476
  const words = new Uint32Array(16)
  for (let offset = 0; offset < total; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = view.getUint32(offset + index * 4, true)
    }
    let a = a0
    let b = b0
    let c = c0
    let d = d0
    for (let index = 0; index < 64; index += 1) {
      let mix: number
      let slot: number
      if (index < 16) {
        mix = (b & c) | (~b & d)
        slot = index
      } else if (index < 32) {
        mix = (d & b) | (~d & c)
        slot = (5 * index + 1) % 16
      } else if (index < 48) {
        mix = b ^ c ^ d
        slot = (3 * index + 5) % 16
      } else {
        mix = c ^ (b | ~d)
        slot = (7 * index) % 16
      }
      const previous = d
      d = c
      c = b
      const sum = (a + mix + constants[index] + words[slot]) | 0
      b = (b + ((sum << shifts[index]) | (sum >>> (32 - shifts[index])))) | 0
      a = previous
    }
    a0 = (a0 + a) | 0
    b0 = (b0 + b) | 0
    c0 = (c0 + c) | 0
    d0 = (d0 + d) | 0
  }
  const digest = new Uint8Array(16)
  const out = new DataView(digest.buffer)
  out.setUint32(0, a0 >>> 0, true)
  out.setUint32(4, b0 >>> 0, true)
  out.setUint32(8, c0 >>> 0, true)
  out.setUint32(12, d0 >>> 0, true)
  return toHex(digest)
}

const digestHex = async (algorithm: DigestAlgorithm, bytes: Uint8Array): Promise<string> => {
  const subtle = globalThis.crypto?.subtle
  if (subtle) {
    try {
      // 复制一份，拿到确定以 ArrayBuffer 为底的视图（BufferSource 的类型要求）
      const input = new Uint8Array(bytes)
      const digest = await subtle.digest(algorithm, input)
      return toHex(new Uint8Array(digest))
    } catch {
      // 浏览器与 Node 都不给 MD5，交给纯 JS 实现
    }
  }
  if (algorithm === 'MD5') {
    return md5Hex(bytes)
  }
  throw new VmError(
    'ENOSYS',
    `当前环境不可用 WebCrypto，无法计算 ${algorithm}（页面需要 https 或 localhost）`
  )
}

const checkChecksums = async (
  ctx: AppletContext,
  command: string,
  algorithm: DigestAlgorithm,
  listFile: string
): Promise<AppletResult> => {
  let raw: Uint8Array
  try {
    raw = readInputBytes(ctx, listFile)
  } catch (error) {
    return fail(`${command}: ${listFile}: ${describeError(error)}\n`)
  }
  const lines = new TextDecoder().decode(raw).split('\n')
  const output: string[] = []
  let failures = 0
  for (const line of lines) {
    if (interrupted(ctx)) {
      return { code: 130, stdout: output.join(''), stderr: `${command}: interrupted\n` }
    }
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) {
      continue
    }
    const match = /^([0-9a-fA-F]{32,128})\s+[* ]?(.+)$/.exec(trimmed)
    if (!match) {
      output.push(`${trimmed}: 格式不正确\n`)
      failures += 1
      continue
    }
    const expected = match[1].toLowerCase()
    const file = match[2].trim()
    try {
      const actual = await digestHex(algorithm, readInputBytes(ctx, file))
      if (actual === expected) {
        output.push(`${file}: OK\n`)
      } else {
        output.push(`${file}: FAILED\n`)
        failures += 1
      }
    } catch {
      output.push(`${file}: FAILED open or read\n`)
      failures += 1
    }
  }
  if (failures > 0) {
    return {
      code: 1,
      stdout: output.join(''),
      stderr: `${command}: WARNING: ${failures} 个校验和不匹配\n`,
    }
  }
  return { code: 0, stdout: output.join('') }
}

const makeChecksumApplet = (
  name: string,
  algorithm: DigestAlgorithm,
  summary: string,
  summaryEn: string
): Applet => ({
  name,
  summary,
  summaryEn,
  usage: `${name} [-bc] [file...]`,
  run: async (ctx: AppletContext): Promise<AppletResult> => {
    if (wantsHelp(ctx.argv)) {
      return ok(`${name} [-bc] [file...]\n`)
    }
    const parsed = parseArgs(ctx.argv, { b: 'boolean', c: 'boolean', t: 'boolean' })
    if (parsed.error) {
      return fail(`${name}: ${parsed.error}\n`)
    }
    const files = parsed.operands.length > 0 ? parsed.operands : ['-']
    if (flagOn(parsed.flags, 'c')) {
      return checkChecksums(ctx, name, algorithm, files[0])
    }
    const output: string[] = []
    for (const file of files) {
      if (interrupted(ctx)) {
        return { code: 130, stdout: output.join(''), stderr: `${name}: interrupted\n` }
      }
      let hex: string
      try {
        hex = await digestHex(algorithm, readInputBytes(ctx, file))
      } catch (error) {
        return {
          code: 1,
          stdout: output.join(''),
          stderr: `${name}: ${file}: ${describeError(error)}\n`,
        }
      }
      output.push(`${hex}  ${file}\n`)
    }
    return { code: 0, stdout: output.join('') }
  },
})

// ---------- base64 ----------

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

const encodeBase64 = (bytes: Uint8Array): string => {
  let text = ''
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index]
    const hasSecond = index + 1 < bytes.length
    const hasThird = index + 2 < bytes.length
    const second = hasSecond ? bytes[index + 1] : 0
    const third = hasThird ? bytes[index + 2] : 0
    text += BASE64_CHARS[first >> 2]
    text += BASE64_CHARS[((first & 0x03) << 4) | (second >> 4)]
    text += hasSecond ? BASE64_CHARS[((second & 0x0f) << 2) | (third >> 6)] : '='
    text += hasThird ? BASE64_CHARS[third & 0x3f] : '='
  }
  return text
}

const decodeBase64 = (text: string): Uint8Array | null => {
  const cleaned = text.replace(/\s+/g, '')
  if (cleaned === '') {
    return new Uint8Array(0)
  }
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(cleaned)) {
    return null
  }
  const body = cleaned.replace(/=+$/, '')
  if (body.length % 4 === 1) {
    return null
  }
  const out: number[] = []
  let buffer = 0
  let bits = 0
  for (const char of body) {
    const value = BASE64_CHARS.indexOf(char)
    if (value < 0) {
      return null
    }
    buffer = (buffer << 6) | value
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out.push((buffer >> bits) & 0xff)
    }
  }
  return new Uint8Array(out)
}

const wrapBase64 = (text: string, width: number): string => {
  if (width <= 0 || text.length <= width) {
    return `${text}\n`
  }
  const lines: string[] = []
  for (let index = 0; index < text.length; index += width) {
    lines.push(text.slice(index, index + width))
  }
  return `${lines.join('\n')}\n`
}

const base64Usage = 'base64 [-d] [-w N] [file]｜默认每 76 字符折行，-w 0 不折行'

const base64Applet: Applet = {
  name: 'base64',
  summary: 'base64 编码文件或标准输入，-d 解码，-w N 控制折行',
  summaryEn: 'Base64 encode or decode a file (or stdin); -w N sets line width',
  usage: base64Usage,
  run: (ctx: AppletContext): AppletResult => {
    if (wantsHelp(ctx.argv)) {
      return ok(`${base64Usage}\n`)
    }
    const parsed = parseArgs(ctx.argv, { d: 'boolean', w: 'value' })
    if (parsed.error) {
      return fail(`base64: ${parsed.error}\n`)
    }
    if (parsed.operands.length > 1) {
      return fail(`base64: extra operand '${parsed.operands[1]}'\n`)
    }
    const decode = flagOn(parsed.flags, 'd')
    const widthText = flagText(parsed.flags, 'w')
    let width = 76
    if (widthText !== null) {
      const parsedWidth = Number.parseInt(widthText, 10)
      if (!Number.isFinite(parsedWidth) || parsedWidth < 0) {
        return fail('base64: invalid wrap size\n')
      }
      width = parsedWidth
    }
    const file = parsed.operands[0] ?? '-'
    let bytes: Uint8Array
    try {
      bytes = readInputBytes(ctx, file)
    } catch (error) {
      return fail(`base64: ${file}: ${describeError(error)}\n`)
    }
    if (!decode) {
      return { code: 0, stdout: wrapBase64(encodeBase64(bytes), width) }
    }
    const decoded = decodeBase64(new TextDecoder().decode(bytes))
    if (decoded === null) {
      return fail('base64: invalid input\n')
    }
    const text = decodeText(decoded)
    if (text === null || hasNul(decoded)) {
      return fail(`base64: 解码结果是${BINARY_HINT}\n`)
    }
    return { code: 0, stdout: withNewline(text) }
  },
}

// ---------- cksum ----------

/** POSIX cksum 的 CRC-32 表：多项式 0x04C11DB7，高位在前 */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index << 24
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 0x80000000) !== 0 ? ((value << 1) ^ 0x04c11db7) >>> 0 : (value << 1) >>> 0
    }
    table[index] = value >>> 0
  }
  return table
})()

/** cksum 的算法：文件内容 + 长度的字节依次过 CRC，最后取反 */
const cksumCrc = (bytes: Uint8Array): number => {
  let crc = 0
  for (const byte of bytes) {
    crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) ^ byte) & 0xff]) >>> 0
  }
  for (let size = bytes.length; size !== 0; size = Math.floor(size / 256)) {
    crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) ^ (size & 0xff)) & 0xff]) >>> 0
  }
  return ~crc >>> 0
}

const cksumApplet: Applet = {
  name: 'cksum',
  summary: 'POSIX cksum：输出 CRC32、字节数与文件名',
  summaryEn: 'POSIX cksum: CRC32 checksum, byte count and file name',
  usage: 'cksum [file...]',
  run: (ctx: AppletContext): AppletResult => {
    if (wantsHelp(ctx.argv)) {
      return ok('cksum [file...]\n')
    }
    const parsed = parseArgs(ctx.argv, {})
    if (parsed.error) {
      return fail(`cksum: ${parsed.error}\n`)
    }
    const files = parsed.operands.length > 0 ? parsed.operands : ['']
    const output: string[] = []
    for (const file of files) {
      if (interrupted(ctx)) {
        return { code: 130, stdout: output.join(''), stderr: 'cksum: interrupted\n' }
      }
      let bytes: Uint8Array
      try {
        bytes = readInputBytes(ctx, file === '' ? '-' : file)
      } catch (error) {
        return {
          code: 1,
          stdout: output.join(''),
          stderr: `cksum: ${file}: ${describeError(error)}\n`,
        }
      }
      const crc = cksumCrc(bytes)
      output.push(
        file === '' ? `${crc} ${bytes.byteLength}\n` : `${crc} ${bytes.byteLength} ${file}\n`
      )
    }
    return { code: 0, stdout: output.join('') }
  },
}

// ---------- diff ----------

type DiffOp = { kind: 'equal' | 'delete' | 'insert'; text: string }

const DIFF_CONTEXT = 3
/** 差异过大时不跑 Myers（留一份内存与时间上限），退化成整段替换 */
const DIFF_MYERS_LIMIT = 8000
const DIFF_MYERS_EDITS = 256

const splitDiffLines = (text: string): { lines: string[]; finalNewline: boolean } => {
  const lines = text.split('\n')
  const finalNewline = lines.at(-1) === ''
  if (finalNewline) {
    lines.pop()
  }
  return { lines, finalNewline }
}

/** Myers 差分（O(ND)）：返回逐行操作，路径存不下时返回 null */
const myersDiff = (left: string[], right: string[]): DiffOp[] | null => {
  const n = left.length
  const m = right.length
  if (n + m > DIFF_MYERS_LIMIT) {
    return null
  }
  const max = n + m
  const offset = max + 1
  const v = new Int32Array(2 * max + 3)
  const trace: Int32Array[] = []
  const limit = Math.min(max, DIFF_MYERS_EDITS)
  let solution = -1
  for (let distance = 0; distance <= limit; distance += 1) {
    trace.push(v.slice())
    for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
      let x: number
      if (
        diagonal === -distance ||
        (diagonal !== distance && v[offset + diagonal - 1] < v[offset + diagonal + 1])
      ) {
        x = v[offset + diagonal + 1]
      } else {
        x = v[offset + diagonal - 1] + 1
      }
      let y = x - diagonal
      while (x < n && y < m && left[x] === right[y]) {
        x += 1
        y += 1
      }
      v[offset + diagonal] = x
      if (x >= n && y >= m) {
        solution = distance
        break
      }
    }
    if (solution >= 0) {
      break
    }
  }
  if (solution < 0) {
    return null
  }
  const ops: DiffOp[] = []
  let x = n
  let y = m
  for (let distance = solution; distance >= 0; distance -= 1) {
    const vAt = trace[distance]
    const diagonal = x - y
    let prevDiagonal = 0
    if (distance > 0) {
      prevDiagonal =
        diagonal === -distance ||
        (diagonal !== distance && vAt[offset + diagonal - 1] < vAt[offset + diagonal + 1])
          ? diagonal + 1
          : diagonal - 1
    }
    const prevX = distance > 0 ? vAt[offset + prevDiagonal] : 0
    const prevY = prevX - prevDiagonal
    while (x > prevX && y > prevY) {
      ops.push({ kind: 'equal', text: left[x - 1] })
      x -= 1
      y -= 1
    }
    if (distance > 0) {
      if (x === prevX) {
        ops.push({ kind: 'insert', text: right[y - 1] })
        y -= 1
      } else {
        ops.push({ kind: 'delete', text: left[x - 1] })
        x -= 1
      }
    }
  }
  return ops.reverse()
}

const diffSequences = (left: string[], right: string[]): DiffOp[] => {
  const ops: DiffOp[] = []
  let start = 0
  while (start < left.length && start < right.length && left[start] === right[start]) {
    ops.push({ kind: 'equal', text: left[start] })
    start += 1
  }
  let endLeft = left.length
  let endRight = right.length
  while (endLeft > start && endRight > start && left[endLeft - 1] === right[endRight - 1]) {
    endLeft -= 1
    endRight -= 1
  }
  const middleLeft = left.slice(start, endLeft)
  const middleRight = right.slice(start, endRight)
  if (middleLeft.length === 0) {
    for (const line of middleRight) {
      ops.push({ kind: 'insert', text: line })
    }
  } else if (middleRight.length === 0) {
    for (const line of middleLeft) {
      ops.push({ kind: 'delete', text: line })
    }
  } else {
    const middle = myersDiff(middleLeft, middleRight)
    if (middle) {
      ops.push(...middle)
    } else {
      for (const line of middleLeft) {
        ops.push({ kind: 'delete', text: line })
      }
      for (const line of middleRight) {
        ops.push({ kind: 'insert', text: line })
      }
    }
  }
  for (let index = endLeft; index < left.length; index += 1) {
    ops.push({ kind: 'equal', text: left[index] })
  }
  return ops
}

const rangeText = (start: number, count: number): string =>
  count === 1 ? String(start) : `${start},${count}`

const unifiedDiff = (
  leftLabel: string,
  rightLabel: string,
  left: { lines: string[]; finalNewline: boolean },
  right: { lines: string[]; finalNewline: boolean },
  context: number
): string => {
  const ops = diffSequences(left.lines, right.lines)
  const changed: number[] = []
  for (let index = 0; index < ops.length; index += 1) {
    if (ops[index].kind !== 'equal') {
      changed.push(index)
    }
  }
  if (changed.length === 0) {
    // 内容一样但结尾换行不同：把最后一行当成「删掉 + 加回」，GNU 也是这样报的
    if (left.finalNewline === right.finalNewline || ops.length === 0) {
      return ''
    }
    const lastIndex = ops.length - 1
    const text = ops[lastIndex].text
    ops.splice(lastIndex, 1, { kind: 'delete', text }, { kind: 'insert', text })
    changed.push(lastIndex, lastIndex + 1)
  }
  // 结尾换行的处理会改动操作表，前缀行数要在这之后再算
  const oldBefore = new Int32Array(ops.length + 1)
  const newBefore = new Int32Array(ops.length + 1)
  for (let index = 0; index < ops.length; index += 1) {
    const op = ops[index]
    oldBefore[index + 1] = oldBefore[index] + (op.kind === 'insert' ? 0 : 1)
    newBefore[index + 1] = newBefore[index] + (op.kind === 'delete' ? 0 : 1)
  }
  const totalOld = oldBefore[ops.length]
  const totalNew = newBefore[ops.length]
  const out: string[] = [`--- ${leftLabel}\n`, `+++ ${rightLabel}\n`]
  let cursor = 0
  while (cursor < changed.length) {
    const start = Math.max(0, changed[cursor] - context)
    let last = changed[cursor]
    cursor += 1
    // 两组改动的间距不超过 2 * context 时并进同一个 hunk，格式与 GNU 一致
    while (cursor < changed.length && changed[cursor] - last <= context * 2 + 1) {
      last = changed[cursor]
      cursor += 1
    }
    const end = Math.min(ops.length - 1, last + context)
    const oldCount = oldBefore[end + 1] - oldBefore[start]
    const newCount = newBefore[end + 1] - newBefore[start]
    const oldStart = oldCount === 0 ? oldBefore[start] : oldBefore[start] + 1
    const newStart = newCount === 0 ? newBefore[start] : newBefore[start] + 1
    out.push(`@@ -${rangeText(oldStart, oldCount)} +${rangeText(newStart, newCount)} @@\n`)
    for (let index = start; index <= end; index += 1) {
      const op = ops[index]
      const prefix = op.kind === 'equal' ? ' ' : op.kind === 'delete' ? '-' : '+'
      out.push(`${prefix}${op.text}\n`)
      if (op.kind !== 'insert' && !left.finalNewline && oldBefore[index + 1] === totalOld) {
        out.push('\\ No newline at end of file\n')
      }
      if (op.kind !== 'delete' && !right.finalNewline && newBefore[index + 1] === totalNew) {
        out.push('\\ No newline at end of file\n')
      }
    }
  }
  return out.join('')
}

const diffLabel = (path: string, prefix: string): string => {
  const trimmed = path.replace(/^\.\//, '').replace(/^\/+/, '')
  return trimmed === '' ? prefix : `${prefix}/${trimmed}`
}

const diffUsage = 'diff [-uNq] [-U N] file1 file2'

const diffApplet: Applet = {
  name: 'diff',
  summary: '比较两个文本文件，输出 unified diff（-q 只报差异，-N 把缺失文件当空）',
  summaryEn: 'Compare two text files with unified diff output',
  usage: diffUsage,
  run: (ctx: AppletContext): AppletResult => {
    if (wantsHelp(ctx.argv)) {
      return ok(`${diffUsage}\n`)
    }
    const parsed = parseArgs(ctx.argv, { u: 'boolean', N: 'boolean', q: 'boolean', U: 'value' })
    if (parsed.error) {
      return fail(`diff: ${parsed.error}\n`, 2)
    }
    const operands = parsed.operands
    if (operands.length !== 2) {
      const reason = operands.length < 2 ? '缺少操作数（需要两个文件）' : '一次只支持比较两个文件'
      return fail(`diff: ${reason}\n`, 2)
    }
    const treatMissingAsEmpty = flagOn(parsed.flags, 'N')
    let context = DIFF_CONTEXT
    const contextText = flagText(parsed.flags, 'U')
    if (contextText !== null) {
      const parsedContext = Number.parseInt(contextText, 10)
      if (!Number.isFinite(parsedContext) || parsedContext < 0) {
        return fail('diff: 非法的上下文行数\n', 2)
      }
      context = parsedContext
    }
    const read = (path: string): Uint8Array | null => {
      try {
        return ctx.fs.read(resolvePath(ctx.cwd, path))
      } catch (error) {
        throw new VmError('EINVAL', `${path}: ${describeError(error)}`)
      }
    }
    let leftBytes: Uint8Array | null
    let rightBytes: Uint8Array | null
    try {
      leftBytes = read(operands[0])
      rightBytes = read(operands[1])
    } catch (error) {
      return fail(`diff: ${describeError(error)}\n`, 2)
    }
    if (leftBytes === null) {
      if (!treatMissingAsEmpty) {
        return fail(`diff: ${operands[0]}: No such file or directory\n`, 2)
      }
      leftBytes = new Uint8Array(0)
    }
    if (rightBytes === null) {
      if (!treatMissingAsEmpty) {
        return fail(`diff: ${operands[1]}: No such file or directory\n`, 2)
      }
      rightBytes = new Uint8Array(0)
    }
    const leftText = decodeText(leftBytes)
    const rightText = decodeText(rightBytes)
    if (leftText === null || rightText === null || hasNul(leftBytes) || hasNul(rightBytes)) {
      return {
        code: 1,
        stdout: `Binary files ${operands[0]} and ${operands[1]} differ\n`,
      }
    }
    const left = splitDiffLines(leftText)
    const right = splitDiffLines(rightText)
    const same =
      left.finalNewline === right.finalNewline &&
      left.lines.length === right.lines.length &&
      left.lines.every((line, index) => line === right.lines[index])
    if (same) {
      return { code: 0 }
    }
    if (flagOn(parsed.flags, 'q')) {
      return { code: 1, stdout: `Files ${operands[0]} and ${operands[1]} differ\n` }
    }
    const text = unifiedDiff(
      diffLabel(operands[0], 'a'),
      diffLabel(operands[1], 'b'),
      left,
      right,
      context
    )
    if (text === '') {
      return { code: 0 }
    }
    return { code: 1, stdout: text }
  },
}

/** 归档 / 校验 / 比较类命令 */
export const ARCHIVE_APPLETS: Applet[] = [
  gzipApplet,
  gunzipApplet,
  tarApplet,
  makeChecksumApplet(
    'sha256sum',
    'SHA-256',
    '计算 SHA-256 校验和，-c 校验清单文件',
    'Compute SHA-256 checksums; -c checks a list'
  ),
  makeChecksumApplet(
    'sha1sum',
    'SHA-1',
    '计算 SHA-1 校验和，-c 校验清单文件',
    'Compute SHA-1 checksums; -c checks a list'
  ),
  makeChecksumApplet(
    'md5sum',
    'MD5',
    '计算 MD5 校验和（浏览器不支持时用内置实现），-c 校验清单文件',
    'Compute MD5 checksums with a built-in fallback; -c checks a list'
  ),
  cksumApplet,
  base64Applet,
  diffApplet,
]
