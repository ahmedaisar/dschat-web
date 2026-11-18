import { resolvePath } from '../fs.js'
import type { NanovmFS } from '../fs.js'
import type { Word, WordPart } from './parse.js'
import { parseWordList } from './parse.js'

/**
 * 单词展开：变量、波浪号、命令替换、通配符，以及引号语义。
 *
 * 解析器保留了「哪一段被引号包住」，这里据此决定：
 *   - 被引号（或反斜杠）包住的 * ? [ 不做通配
 *   - 单引号里的 $ 在解析阶段就已经是字面量
 *   - 通配符没命中时保留原样，符合 sh 的默认行为
 *   - 变量与命令替换的结果不再二次通配（本实现不做 field splitting）
 *
 * 命令替换要真的执行命令，所以展开是异步的；ShellApi.expand 需要同步结果，
 * 走 expandLiteral（只对字面量参数做通配符展开）。
 */

/** NanoVM 没有真正的进程表：`$$` 固定为 1，与 ps 里那条 sh 对齐 */
export const SHELL_PID = 1

/** 命令替换最多嵌套几层 */
const MAX_SUBSTITUTION_DEPTH = 3

/** 别名最多连续替换几次，避免 ll='ll' 这种自引用 */
const MAX_ALIAS_ROUNDS = 8

const GLOB_CHARS = /[*?[]/

export type ExpandContext = {
  fs: NanovmFS
  cwd: string
  env: Record<string, string>
  /** 上一条命令的退出码，`$?` 用 */
  lastCode?: number
  /** 位置参数：$0 是脚本名，$1… 是参数（执行脚本时设置） */
  params?: { name: string; args: string[] }
  /** 命令替换的执行器；缺省时 `$(...)` 展开成空串 */
  run?: (line: string) => Promise<string>
  /** 命令替换嵌套层数 */
  depth?: number
}

/** 一个词展开后的状态：文本 + 哪些通配符真的该生效 */
type Expanded = {
  text: string
  /** 未加引号的通配符：可以展开 */
  rawGlob: boolean
  /** 被引号/转义保护的通配符：整个词都不展开 */
  quotedGlob: boolean
}

const homeDir = (env: Record<string, string>): string => env.HOME || '/home/user'

const variableValue = (name: string, context: ExpandContext): string => {
  if (name === '?') {
    return String(context.lastCode ?? 0)
  }
  if (name === '$') {
    return String(SHELL_PID)
  }
  const args = context.params?.args ?? []
  if (name === '#') {
    return String(args.length)
  }
  // "$@" 在真正的 shell 里会展开成多个词，这里不做词分割，用空格拼起来
  if (name === '@' || name === '*') {
    return args.join(' ')
  }
  if (/^\d+$/.test(name)) {
    const index = Number(name)
    // $0 是脚本名，$1 起是参数
    return index === 0 ? (context.params?.name ?? 'sh') : (args[index - 1] ?? '')
  }
  return context.env[name] ?? ''
}

/** 递归展开片段列表；命令替换在这里真正执行 */
const expandParts = async (parts: WordPart[], context: ExpandContext): Promise<Expanded> => {
  let text = ''
  let rawGlob = false
  let quotedGlob = false
  for (const part of parts) {
    if (part.kind === 'home') {
      text += homeDir(context.env)
      continue
    }
    if (part.kind === 'text') {
      text += part.text
      if (GLOB_CHARS.test(part.text)) {
        if (part.quoted) {
          quotedGlob = true
        } else {
          rawGlob = true
        }
      }
      continue
    }
    if (part.kind === 'var') {
      const value = variableValue(part.name, context)
      if (value !== '' || !part.fallback) {
        text += value
        continue
      }
      // ${VAR:-默认值}：变量为空或未设置时用默认值，默认值本身也展开
      const fallback = await expandParts(part.fallback, context)
      text += fallback.text
      rawGlob ||= fallback.rawGlob
      quotedGlob ||= fallback.quotedGlob
      continue
    }
    // $(...) 命令替换
    text += await substitute(part.source, context)
  }
  return { text, rawGlob, quotedGlob }
}

const substitute = async (source: string, context: ExpandContext): Promise<string> => {
  const depth = context.depth ?? 0
  if (!context.run || depth >= MAX_SUBSTITUTION_DEPTH) {
    return ''
  }
  const stdout = await context.run(source)
  // POSIX：命令替换会去掉末尾所有换行
  return stdout.replace(/\n+$/, '')
}

/** 展开一个词；返回 0..n 个结果（通配符命中多个文件时会变多个） */
export const expandWord = async (
  word: Word,
  context: ExpandContext,
  options: { glob?: boolean } = {}
): Promise<string[]> => {
  const expanded = await expandParts(word.parts, context)
  // 未加引号的空展开不产生参数；"" 会产生一个空参数
  if (expanded.text === '' && !word.quoted) {
    return []
  }
  if (options.glob === false || !expanded.rawGlob || expanded.quotedGlob) {
    return [expanded.text]
  }
  const matches = context.fs.glob(resolvePath(context.cwd, expanded.text))
  return matches.length > 0 ? matches : [expanded.text]
}

/** 依次展开多个词，结果摊平（像 shell 把一行拆成 argv） */
export const expandWords = async (
  words: Word[],
  context: ExpandContext,
  options: { glob?: boolean } = {}
): Promise<string[]> => {
  const out: string[] = []
  for (const word of words) {
    out.push(...(await expandWord(word, context, options)))
  }
  return out
}

/** 展开成单个字符串：赋值右侧、重定向目标用，不做通配 */
export const expandSingle = async (word: Word, context: ExpandContext): Promise<string> => {
  const values = await expandWord(word, context, { glob: false })
  return values[0] ?? ''
}

/**
 * 命令词上的别名替换。
 *
 * `alias ll='ls -l'` 在应用集里写成环境变量 `ALIAS_ll=ls -l`，
 * 展开器读它做替换；替换出来的部分照常展开（含引号与变量），
 * 所以 `alias l='ls -l'` 之后 `l /tmp` 等价于 `ls -l /tmp`。
 */
export const expandAliases = async (words: Word[], context: ExpandContext): Promise<string[]> => {
  let expanded = await expandWords(words, context)
  const applied = new Set<string>()
  for (let round = 0; round < MAX_ALIAS_ROUNDS; round += 1) {
    const name = expanded[0]
    if (!name || applied.has(name)) {
      break
    }
    const alias = context.env[`ALIAS_${name}`]
    if (!alias || alias.trim().length === 0) {
      break
    }
    applied.add(name)
    const replacement = await expandWords(parseWordList(alias), context)
    expanded = [...replacement, ...expanded.slice(1)]
  }
  return expanded
}

/**
 * 同步通配符展开，ShellApi.expand 用。
 *
 * 参数是应用集已经拿到的字面量（引号与变量早由 shell 处理完），
 * 所以这里只补一次通配符：`*.txt` → 绝对路径列表，没命中就原样返回。
 */
export const expandLiteral = (
  words: string[],
  context: { fs: NanovmFS; cwd: string; env: Record<string, string> }
): string[] => {
  const out: string[] = []
  for (const word of words) {
    if (!GLOB_CHARS.test(word)) {
      out.push(word)
      continue
    }
    const matches = context.fs.glob(resolvePath(context.cwd, word))
    if (matches.length === 0) {
      out.push(word)
    } else {
      out.push(...matches)
    }
  }
  return out
}
