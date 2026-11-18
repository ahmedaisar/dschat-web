/**
 * NanoVM Slim 的 shell 解析器：词法 + 语法。
 *
 * 这里只做「把一行命令变成 AST」一件事。变量展开、通配符、命令替换在 expand.ts，
 * 真正执行在 exec.ts。
 *
 * 解析阶段会保留引号语义（哪一段被引号包住、哪些字符被转义），因为展开阶段要靠它
 * 决定 `*` 是否当通配符、`$` 是否插值。一个 Word 由若干 WordPart 组成，
 * 例如 `pre"$X"post` 是 [text(pre) var(X, quoted) text(post)]。
 *
 * 语法：
 *   script    := list
 *   list      := pipeline ((';' | '&' | '&&' | '||' | '\n') pipeline)*
 *   pipeline  := command ('|' command)*
 *   command   := (assignment | word | redirect)*
 */

/** 单词片段 */
export type WordPart =
  | { kind: 'text'; text: string; quoted: boolean }
  | { kind: 'var'; name: string; quoted: boolean; fallback: WordPart[] | null }
  | { kind: 'command'; source: string; quoted: boolean }
  | { kind: 'home' }

/** 一个词（参数、或者赋值右侧） */
export type Word = {
  parts: WordPart[]
  /** 至少有一段来自引号：空串也算一个参数 */
  quoted: boolean
  /** 原始写法，报错提示用 */
  raw: string
}

/** 重定向种类 */
export type RedirectOperator =
  | 'write'
  | 'append'
  | 'read'
  | 'writeErr'
  | 'appendErr'
  | 'writeAll'
  | 'appendAll'
  /** 2>&1：stderr 并到 stdout */
  | 'dupErr'
  /** 1>&2：stdout 并到 stderr */
  | 'dupOut'
  /** << / <<-：标准输入来自 here-document */
  | 'heredoc'

export type Redirect = {
  op: RedirectOperator
  /** 目标文件；dup*、heredoc 没有目标 */
  target: Word | null
  /** 原始写法，例如 2>> */
  raw: string
  /** here-document 的正文，解析器在行尾之后填充 */
  heredoc?: {
    body: string
    /** 分隔符没加引号时才做变量替换 */
    expand: boolean
  }
}

/** 前置赋值：FOO=1 cmd */
export type Assignment = {
  name: string
  value: Word
}

/** 一条简单命令 */
export type SimpleCommand = {
  words: Word[]
  redirects: Redirect[]
  assignments: Assignment[]
}

export type Pipeline = {
  stages: SimpleCommand[]
  /** 原始文本，后台执行提示时用 */
  raw: string
}

/** 与上一条命令的连接方式 */
export type ListConnector = 'start' | 'always' | 'and' | 'or'

export type ListItem = {
  connector: ListConnector
  pipeline: Pipeline
  /** 以 & 结尾 */
  background: boolean
}

export type ParsedScript = {
  items: ListItem[]
}

/** 解析错误：engine 会把 message 原样写到 stderr，退出码 2 */
export class ShellParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ShellParseError'
  }
}

// ---------- 词法 ----------

/** 在 word 模式里结束一个词的字符 */
const STOP_CHARS = new Set([' ', '\t', '\r', '\n', '|', '&', ';', '<', '>', '(', ')'])

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*/

/** 把一段词法读成 WordPart；mode=fragment 时一直读到结尾（用于 ${X:-默认值}） */
type ReadResult = { parts: WordPart[]; quoted: boolean; end: number }

/**
 * 读 $( ) 的内部：要跳过引号与嵌套括号。
 * start 指向 '(' 的下标，返回 ')' 之后的位置。
 */
const readCommandSub = (source: string, start: number): { inner: string; end: number } | null => {
  let depth = 0
  let quote: string | null = null
  let index = start
  while (index < source.length) {
    const char = source[index]
    if (quote) {
      if (char === '\\' && quote === '"') {
        index += 2
        continue
      }
      if (char === quote) {
        quote = null
      }
      index += 1
      continue
    }
    if (char === '\\') {
      index += 2
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      index += 1
      continue
    }
    if (char === '(') {
      depth += 1
      index += 1
      continue
    }
    if (char === ')') {
      depth -= 1
      if (depth === 0) {
        return { inner: source.slice(start + 1, index), end: index + 1 }
      }
      index += 1
      continue
    }
    index += 1
  }
  return null
}

/** 找 ${...} 的收尾 '}'，支持嵌套 ${} */
const findBrace = (source: string, start: number): number => {
  let depth = 0
  for (let index = start; index < source.length; index += 1) {
    const char = source[index]
    if (char === '\\') {
      index += 1
      continue
    }
    if (char === '$' && source[index + 1] === '{') {
      depth += 1
      index += 1
      continue
    }
    if (char === '}') {
      if (depth === 0) {
        return index
      }
      depth -= 1
    }
  }
  return -1
}

/** 解析 $ 开头的展开；不认识时返回 null（调用方当字面 $ 处理） */
const readDollar = (
  source: string,
  index: number,
  quoted: boolean
): { part: WordPart; end: number } | null => {
  const next = source[index + 1]
  if (next === undefined) {
    return null
  }
  if (next === '$' || next === '?' || next === '#' || next === '@' || next === '*') {
    return { part: { kind: 'var', name: next, quoted, fallback: null }, end: index + 2 }
  }
  // $0 / $1 ...：位置参数（${10} 这种走下面的大括号分支）
  if (next >= '0' && next <= '9') {
    return { part: { kind: 'var', name: next, quoted, fallback: null }, end: index + 2 }
  }
  if (next === '{') {
    const close = findBrace(source, index + 2)
    if (close < 0) {
      throw new ShellParseError('syntax error: bad substitution（缺少 }）')
    }
    const body = source.slice(index + 2, close)
    const colon = body.indexOf(':-')
    if (colon > 0) {
      const fallback = readParts(body.slice(colon + 2), 0, 'fragment')
      return {
        part: {
          kind: 'var',
          name: body.slice(0, colon),
          quoted,
          fallback: fallback.parts,
        },
        end: close + 1,
      }
    }
    return { part: { kind: 'var', name: body, quoted, fallback: null }, end: close + 1 }
  }
  if (next === '(') {
    const inner = readCommandSub(source, index + 1)
    if (!inner) {
      throw new ShellParseError('syntax error: unterminated $( command substitution')
    }
    return { part: { kind: 'command', source: inner.inner, quoted }, end: inner.end }
  }
  const name = IDENTIFIER.exec(source.slice(index + 1))
  if (name) {
    return {
      part: { kind: 'var', name: name[0], quoted, fallback: null },
      end: index + 1 + name[0].length,
    }
  }
  return null
}

const readParts = (
  source: string,
  start: number,
  mode: 'word' | 'fragment' | 'heredoc'
): ReadResult => {
  const parts: WordPart[] = []
  let quoted = false
  let index = start

  const pushText = (text: string, isQuoted: boolean): void => {
    if (text.length === 0) {
      return
    }
    const last = parts.at(-1)
    if (last && last.kind === 'text' && last.quoted === isQuoted) {
      parts[parts.length - 1] = { kind: 'text', text: last.text + text, quoted: isQuoted }
      return
    }
    parts.push({ kind: 'text', text, quoted: isQuoted })
  }

  for (;;) {
    if (index >= source.length) {
      break
    }
    const char = source[index]
    if (mode === 'word' && STOP_CHARS.has(char)) {
      break
    }
    // 行尾续行：反斜杠 + 换行在词法阶段就吃掉
    if (char === '\\' && source[index + 1] === '\n') {
      index += 2
      continue
    }
    if (char === '\\' && source[index + 1] === '\r' && source[index + 2] === '\n') {
      index += 3
      continue
    }
    if (char === "'" && mode !== 'heredoc') {
      const close = source.indexOf("'", index + 1)
      if (close < 0) {
        throw new ShellParseError('syntax error: unterminated quoted string')
      }
      quoted = true
      pushText(source.slice(index + 1, close), true)
      index = close + 1
      continue
    }
    if (char === '"' && mode !== 'heredoc') {
      quoted = true
      index += 1
      for (;;) {
        if (index >= source.length) {
          throw new ShellParseError('syntax error: unterminated quoted string')
        }
        const inner = source[index]
        if (inner === '"') {
          index += 1
          break
        }
        if (inner === '\\') {
          const escaped = source[index + 1]
          if (escaped === '$' || escaped === '"' || escaped === '`' || escaped === '\\') {
            pushText(escaped, true)
            index += 2
            continue
          }
          if (escaped === '\n') {
            index += 2
            continue
          }
          pushText('\\', true)
          index += 1
          continue
        }
        if (inner === '$') {
          const read = readDollar(source, index, true)
          if (read) {
            parts.push(read.part)
            index = read.end
            continue
          }
          pushText('$', true)
          index += 1
          continue
        }
        pushText(inner, true)
        index += 1
      }
      continue
    }
    if (char === '\\' && mode === 'heredoc') {
      const escaped = source[index + 1]
      if (escaped === '$' || escaped === '\\' || escaped === '`') {
        pushText(escaped, true)
        index += 2
        continue
      }
      if (escaped === '\n') {
        index += 2
        continue
      }
      pushText('\\', true)
      index += 1
      continue
    }
    if (char === '\\') {
      const escaped = source[index + 1]
      if (escaped === undefined) {
        pushText('\\', true)
        index += 1
        continue
      }
      // 转义出来的字符按「被引号包住」处理：不参与通配
      pushText(escaped, true)
      index += 2
      continue
    }
    if (char === '$') {
      const read = readDollar(source, index, false)
      if (read) {
        parts.push(read.part)
        index = read.end
        continue
      }
      pushText('$', false)
      index += 1
      continue
    }
    if (char === '~' && index === start && mode === 'word') {
      parts.push({ kind: 'home' })
      index += 1
      continue
    }
    pushText(char, false)
    index += 1
  }

  return { parts, quoted, end: index }
}

/** 把 Word 还原成纯文本：here-document 的分隔符只取字面量部分 */
const wordText = (word: Word): string =>
  word.parts
    .map((part) => {
      if (part.kind === 'text') {
        return part.text
      }
      return part.kind === 'home' ? '~' : ''
    })
    .join('')

// ---------- 语法 ----------

/** 解析到 << 时先记下来，等这行结束再吃正文（POSIX 就是这么规定的） */
type PendingHeredoc = {
  redirect: Redirect
  delimiter: string
  /** 分隔符被引号包住 => 正文不做变量替换 */
  quoted: boolean
  stripTabs: boolean
}

class LineParser {
  private readonly source: string
  private index = 0
  private pending: PendingHeredoc[] = []

  constructor(source: string) {
    this.source = source
  }

  parse = (): ParsedScript => {
    const items: ListItem[] = []
    let connector: ListConnector = 'start'
    for (;;) {
      this.skipSeparators()
      // 多余的分号（cmd ; ;）直接跳过，别把空命令当错误
      while (this.source[this.index] === ';') {
        this.index += 1
        this.skipSeparators()
      }
      if (this.index >= this.source.length) {
        break
      }
      const start = this.index
      const pipeline = this.parsePipeline()
      const item: ListItem = {
        connector,
        pipeline: { ...pipeline, raw: this.source.slice(start, this.index).trim() },
        background: false,
      }
      items.push(item)
      this.skipInline()
      const char = this.source[this.index]
      if (char === '&' && this.source[this.index + 1] === '&') {
        this.index += 2
        connector = 'and'
        continue
      }
      if (char === '&') {
        this.index += 1
        item.background = true
        connector = 'always'
        continue
      }
      if (char === '|' && this.source[this.index + 1] === '|') {
        this.index += 2
        connector = 'or'
        continue
      }
      if (char === ';' || char === '\n') {
        if (char === '\n' && this.pending.length > 0) {
          // consumeHeredocs 会把换行和正文一起吃掉
          this.consumeHeredocs()
        } else {
          this.index += 1
        }
        connector = 'always'
        continue
      }
      if (this.index >= this.source.length) {
        break
      }
      throw new ShellParseError(`syntax error: unexpected token '${char}'`)
    }
    if (this.pending.length > 0) {
      throw new ShellParseError(
        `syntax error: unterminated here-document（缺少结束标记 '${this.pending[0].delimiter}'，NanoVM Slim 需要一次性提交完整脚本）`
      )
    }
    return { items }
  }

  /** 从行尾的换行开始，按顺序吃掉所有 here-document 正文 */
  private consumeHeredocs = (): void => {
    this.index += 1
    for (const pending of this.pending) {
      const lines: string[] = []
      for (;;) {
        if (this.index >= this.source.length) {
          throw new ShellParseError(
            `syntax error: unterminated here-document（缺少结束标记 '${pending.delimiter}'，NanoVM Slim 需要一次性提交完整脚本）`
          )
        }
        const newline = this.source.indexOf('\n', this.index)
        const end = newline === -1 ? this.source.length : newline
        let line = this.source.slice(this.index, end)
        this.index = newline === -1 ? this.source.length : newline + 1
        if (pending.stripTabs) {
          line = line.replace(/^\t+/, '')
        }
        if (line === pending.delimiter) {
          break
        }
        lines.push(line)
      }
      pending.redirect.heredoc = {
        body: lines.length > 0 ? `${lines.join('\n')}\n` : '',
        expand: !pending.quoted,
      }
    }
    this.pending = []
  }

  private parsePipeline = (): Pipeline => {
    const first = this.parseCommand()
    if (
      first.words.length === 0 &&
      first.redirects.length === 0 &&
      first.assignments.length === 0
    ) {
      const token = this.source[this.index] ?? 'end of line'
      throw new ShellParseError(`syntax error: unexpected token '${token}'`)
    }
    const stages: SimpleCommand[] = [first]
    for (;;) {
      this.skipInline()
      if (this.source[this.index] !== '|' || this.source[this.index + 1] === '|') {
        break
      }
      this.index += 1
      this.skipInline()
      const stage = this.parseCommand()
      if (
        stage.words.length === 0 &&
        stage.redirects.length === 0 &&
        stage.assignments.length === 0
      ) {
        throw new ShellParseError("syntax error: unexpected end of command after '|'")
      }
      stages.push(stage)
    }
    return { stages, raw: '' }
  }

  private parseCommand = (): SimpleCommand => {
    const words: Word[] = []
    const redirects: Redirect[] = []
    const assignments: Assignment[] = []
    for (;;) {
      this.skipInline()
      if (this.index >= this.source.length) {
        break
      }
      const char = this.source[this.index]
      if (char === '|' || char === ';' || char === '\n') {
        break
      }
      // &> / &>> 是重定向（交给 tryRedirect）；单独的 & 与 && 由列表层处理
      if (char === '&' && this.source[this.index + 1] !== '>') {
        break
      }
      if (char === '(') {
        throw new ShellParseError('NanoVM Slim 不支持子 shell 语法 ( ... )')
      }
      if (char === ')') {
        throw new ShellParseError("syntax error: unexpected token ')'")
      }
      const redirect = this.tryRedirect()
      if (redirect) {
        redirects.push(redirect)
        continue
      }
      const word = this.readWord()
      if (!word) {
        continue
      }
      // 赋值只出现在命令名之前
      if (words.length === 0) {
        const assignment = splitAssignment(word)
        if (assignment) {
          assignments.push(assignment)
          continue
        }
      }
      words.push(word)
    }
    return { words, redirects, assignments }
  }

  private readWord = (): Word | null => {
    const result = readParts(this.source, this.index, 'word')
    if (result.end === this.index) {
      return null
    }
    const raw = this.source.slice(this.index, result.end)
    this.index = result.end
    return { parts: result.parts, quoted: result.quoted, raw }
  }

  private tryRedirect = (): Redirect | null => {
    const rest = this.source.slice(this.index)
    // 2>&1 / 1>&2 / >&2
    const dup = /^(\d?)>&(\d)/.exec(rest)
    if (dup) {
      const from = dup[1] === '' ? 1 : Number(dup[1])
      if (from !== 1 && from !== 2) {
        throw new ShellParseError(`NanoVM Slim 只支持 1>&N 与 2>&N（收到 ${from}>&${dup[2]}）`)
      }
      this.index += dup[0].length
      return { op: from === 1 ? 'dupOut' : 'dupErr', target: null, raw: dup[0] }
    }
    const heredoc = /^<<(-?)/.exec(rest)
    if (heredoc) {
      this.index += heredoc[0].length
      this.skipInline()
      const delimiterWord = this.readWord()
      if (!delimiterWord) {
        throw new ShellParseError("syntax error: expected a delimiter after '<<'")
      }
      const redirect: Redirect = { op: 'heredoc', target: null, raw: `<<${heredoc[1]}` }
      this.pending.push({
        redirect,
        delimiter: wordText(delimiterWord),
        quoted: delimiterWord.quoted,
        stripTabs: heredoc[1] === '-',
      })
      return redirect
    }
    const fdWrite = /^([0-9]+)(>>?)/.exec(rest)
    if (fdWrite && fdWrite[1] !== '1' && fdWrite[1] !== '2') {
      throw new ShellParseError(`NanoVM Slim 只支持 1> 与 2> 重定向（收到 ${fdWrite[1]}>）`)
    }
    const table: [string, RedirectOperator][] = [
      ['&>>', 'appendAll'],
      ['&>', 'writeAll'],
      ['2>>', 'appendErr'],
      ['2>', 'writeErr'],
      ['1>>', 'append'],
      ['1>', 'write'],
      ['>>', 'append'],
      ['>', 'write'],
      ['<', 'read'],
    ]
    for (const [token, op] of table) {
      if (!rest.startsWith(token)) {
        continue
      }
      if (token === '>' && rest.startsWith('>&')) {
        continue
      }
      this.index += token.length
      this.skipInline()
      const target = this.readWord()
      if (!target) {
        throw new ShellParseError(`syntax error: expected a file name after '${token}'`)
      }
      return { op, target, raw: token }
    }
    return null
  }

  /** 跳空格、制表符、续行与注释（不跨行） */
  private skipInline = (): void => {
    for (;;) {
      const char = this.source[this.index]
      if (char === ' ' || char === '\t' || char === '\r') {
        this.index += 1
        continue
      }
      if (char === '\\' && this.source[this.index + 1] === '\n') {
        this.index += 2
        continue
      }
      if (char === '#') {
        while (this.index < this.source.length && this.source[this.index] !== '\n') {
          this.index += 1
        }
        continue
      }
      return
    }
  }

  /** 跳过换行：换行等价于 ; */
  private skipSeparators = (): void => {
    for (;;) {
      this.skipInline()
      if (this.source[this.index] !== '\n') {
        return
      }
      this.index += 1
    }
  }
}

// ---------- 对外接口 ----------

/** 解析一整行（或一段脚本） */
export const parseScript = (line: string): ParsedScript => new LineParser(line).parse()

/** 把一段文本当成参数列表解析：alias 的值、测试用 */
export const parseWordList = (source: string): Word[] => {
  const words: Word[] = []
  let index = 0
  while (index < source.length) {
    while (index < source.length && /\s/.test(source[index])) {
      index += 1
    }
    if (index >= source.length) {
      break
    }
    const result = readParts(source, index, 'word')
    if (result.end === index) {
      index += 1
      continue
    }
    words.push({ parts: result.parts, quoted: result.quoted, raw: source.slice(index, result.end) })
    index = result.end
  }
  return words
}

/**
 * 把 here-document 正文解析成词片段。
 *
 * 正文里的引号是普通字符，只有 $ 展开与反斜杠转义生效——和双引号内的规则一样，
 * 所以 <<'EOF' 这种带引号的分隔符由调用方直接跳过展开。
 */
export const parseHeredoc = (text: string): Word => {
  const result = readParts(text, 0, 'heredoc')
  return { parts: result.parts, quoted: true, raw: text }
}

/** 把一个已经展开过的字符串包装成字面量词（ShellApi.expand 用） */
export const literalWord = (text: string): Word => ({
  parts: text.length > 0 ? [{ kind: 'text', text, quoted: false }] : [],
  quoted: false,
  raw: text,
})

/** 判断一个词是不是 FOO=bar 形式的赋值；是就拆成名字与右侧 */
export const splitAssignment = (word: Word): Assignment | null => {
  const first = word.parts[0]
  if (!first || first.kind !== 'text' || first.quoted) {
    return null
  }
  const match = /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(first.text)
  if (!match) {
    return null
  }
  const rest = first.text.slice(match[0].length)
  const parts: WordPart[] =
    rest.length > 0
      ? [{ kind: 'text', text: rest, quoted: false }, ...word.parts.slice(1)]
      : word.parts.slice(1)
  return {
    name: match[1],
    value: { parts, quoted: word.quoted, raw: word.raw },
  }
}
