import { APPLET_MAP } from '../applets/index.js'
import { vmErrorMessage } from '../applets/helpers.js'
import type { NanovmFS } from '../fs.js'
import { baseName, dirName, normalizePath, resolvePath } from '../fs.js'
import type {
  Applet,
  AppletContext,
  AppletResult,
  ShellApi,
  ShellRunResult,
  ToolchainHost,
  ToolchainId,
} from '../types.js'
import type { WasmKernel } from '../wasm/core.js'
import type { ListItem, ParsedScript, Pipeline, Redirect, SimpleCommand } from './parse.js'
import { ShellParseError, parseHeredoc, parseScript } from './parse.js'
import type { ExpandContext } from './expand.js'
import { expandAliases, expandLiteral, expandSingle } from './expand.js'

/**
 * NanoVM Slim 的执行器。
 *
 * 一次 exec() 的流程：解析 → 逐条管道 → 逐个阶段。阶段之间用字符串传管道数据，
 * 但数据在阶段内部必须经过 WASM 线性内存：stdin 先 alloc + 拷贝进去，命令输出再
 * 写回内存读出成字符串，然后 reset()。这样内存配额就是真在限制管道能搬多少数据。
 *
 * 命令来源的解析顺序：内置 applet → 工具链命令（python3 / node / git）→ 可执行文件
 * （显式路径，或按 $PATH 逐目录查找）。可执行文件按 shebang 分派：shell 脚本用本执行器
 * 嵌套执行，python / node 交给工具链宿主；没有 shebang 就按 Linux 的规矩报 Exec format error。
 *
 * 几条刻意的取舍（NanoVM Slim 没有真正的进程与调度器）：
 *   - 管道阶段串行执行，只有最后一段（且未重定向）的 stdout 推给终端
 *   - `&` 不会真的后台化：打印一句说明后在前台执行，退出码按 0 处理
 *   - cwd / env 在整行命令内共享，`cd` / `export` 立即生效，结尾回传给调用方
 *   - 脚本（shebang / sh script）在子 shell 里跑，cwd / env 不回传给调用方
 */

/** 工具链命令：没装时不报 not found，而是让 UI 提示安装 */
const TOOLCHAIN_COMMANDS: Record<string, ToolchainId> = {
  python: 'python',
  python3: 'python',
  node: 'node',
  nodejs: 'node',
  git: 'git',
}

const encoder = new TextEncoder()

/** 脚本嵌套层数上限，防止 A 调 B、B 调 A 把栈打穿 */
const MAX_SCRIPT_DEPTH = 16

/** 由执行器自己实现的命令（不走应用集，因为要用解释器内部状态） */
const NATIVE_COMMANDS: Record<string, 'exit' | 'sh'> = {
  sh: 'sh',
  bash: 'sh',
  exit: 'exit',
}

/** sh 能接受但本实现不细究的选项（-e / -x 之类） */
const SHELL_OPTIONS = new Set(['-e', '-x', '-u', '-n', '-v', '-s'])

export type ExecHost = {
  fs: NanovmFS
  kernel: WasmKernel
  toolchains: ToolchainHost
  /** 单条命令超时（毫秒） */
  timeoutMs: number
  signal?: AbortSignal
  onOutput?: (text: string, stream: 'stdout' | 'stderr') => void
}

export type ScriptResult = {
  code: number
  cwd: string
  env: Record<string, string>
  install?: ToolchainId
  aborted?: boolean
}

export type ShellRequest = {
  line: string
  cwd: string
  env: Record<string, string>
  /** 上一条命令的退出码，`$?` 用 */
  lastCode?: number
  stdin?: string
}

/** 一次执行期间可变的会话状态 */
type ShellState = {
  cwd: string
  env: Record<string, string>
  lastCode: number
  /** 位置参数：执行脚本 / `sh -c` 时替换 $0 $1… */
  params: { name: string; args: string[] }
}

type Emitter = (text: string, stream: 'stdout' | 'stderr') => void

type RunContext = {
  state: ShellState
  emit: Emitter
  /** 嵌套层数：$(...) 与 shell.run */
  depth: number
  /** 脚本嵌套层数：shebang / sh script */
  scriptDepth: number
  /** 命中的工具链安装提示 */
  install?: ToolchainId
}

/** 一条命令执行完的原始结果（还没经过重定向） */
type RawResult = {
  code: number
  stdout: string
  stderr: string
  install?: ToolchainId
}

/** exit：用异常把控制流抛回最近的脚本边界 */
class ShellExit extends Error {
  readonly code: number

  constructor(code: number) {
    super(`exit ${code}`)
    this.name = 'ShellExit'
    this.code = code
  }
}

type Runner = {
  host: ExecHost
  stop: StopControl
}

type StopControl = {
  signal: AbortSignal
  /** 截止时间戳，交给应用集判断 */
  deadline: number
  interrupted: () => boolean
  timedOut: () => boolean
  note: () => string
  dispose: () => void
}

const describeError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

// ---------- 中断 ----------

const createStop = (host: ExecHost): StopControl => {
  const controller = new AbortController()
  const timeout = Math.max(0, host.timeoutMs)
  const deadline = Date.now() + timeout
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeout)
  const external = host.signal
  const forward = (): void => {
    controller.abort()
  }
  if (external) {
    if (external.aborted) {
      controller.abort()
    } else {
      external.addEventListener('abort', forward, { once: true })
    }
  }
  return {
    signal: controller.signal,
    deadline,
    interrupted: () => controller.signal.aborted || Date.now() > deadline,
    timedOut: () => timedOut,
    note: () => (timedOut ? `Timeout（${timeout}ms）` : '^C'),
    dispose: () => {
      clearTimeout(timer)
      external?.removeEventListener('abort', forward)
    },
  }
}

/** 让一个异步任务可以被中断；同步应用集只能自己检查 deadline */
const raceAbort = async <T>(work: Promise<T>, signal: AbortSignal): Promise<T | 'aborted'> => {
  if (signal.aborted) {
    return 'aborted'
  }
  let listener: (() => void) | null = null
  const aborted = new Promise<'aborted'>((resolve) => {
    listener = () => resolve('aborted')
    signal.addEventListener('abort', listener, { once: true })
  })
  try {
    return await Promise.race([work, aborted])
  } finally {
    if (listener) {
      signal.removeEventListener('abort', listener)
    }
  }
}

// ---------- 重定向 ----------

type RedirectTarget = { path: string; append: boolean }

type RedirectPlan = {
  /** `< file` 的内容；null 表示沿用管道输入 */
  stdinText: string | null
  stdoutTarget: RedirectTarget | null
  stderrTarget: RedirectTarget | null
  /** `&> file`：两个流写同一个文件 */
  bothTarget: RedirectTarget | null
  /** 2>&1 */
  dupErr: boolean
  /** 1>&2 */
  dupOut: boolean
  error?: string
}

const emptyPlan = (): RedirectPlan => ({
  stdinText: null,
  stdoutTarget: null,
  stderrTarget: null,
  bothTarget: null,
  dupErr: false,
  dupOut: false,
})

const planRedirects = async (
  redirects: Redirect[],
  runner: Runner,
  runContext: RunContext
): Promise<RedirectPlan> => {
  const { host } = runner
  const state = runContext.state
  const plan = emptyPlan()
  const context: ExpandContext = {
    fs: host.fs,
    cwd: state.cwd,
    env: state.env,
    lastCode: state.lastCode,
    params: state.params,
    run: (line) => substitute(runner, runContext, line),
    depth: runContext.depth,
  }
  for (const redirect of redirects) {
    if (redirect.op === 'heredoc') {
      const heredoc = redirect.heredoc
      if (!heredoc) {
        plan.error = 'sh: here-document 缺少正文'
        return plan
      }
      // 分隔符带引号时正文原样使用，否则按双引号规则做 $ 展开
      plan.stdinText = heredoc.expand
        ? await expandSingle(parseHeredoc(heredoc.body), context)
        : heredoc.body
      continue
    }
    if (!redirect.target) {
      if (redirect.op === 'dupErr') {
        plan.dupErr = true
      } else {
        plan.dupOut = true
      }
      continue
    }
    const target = await expandSingle(redirect.target, context)
    const path = resolvePath(state.cwd, target)
    if (redirect.op === 'read') {
      try {
        const text = host.fs.readText(path)
        if (text === null) {
          plan.error = `sh: ${target}: No such file or directory`
          return plan
        }
        plan.stdinText = text
      } catch (error) {
        plan.error = `sh: ${target}: ${describeError(error)}`
        return plan
      }
      continue
    }
    if (redirect.op === 'writeAll' || redirect.op === 'appendAll') {
      plan.bothTarget = {
        path,
        append: redirect.op === 'appendAll',
      }
      continue
    }
    if (redirect.op === 'writeErr' || redirect.op === 'appendErr') {
      plan.stderrTarget = { path, append: redirect.op === 'appendErr' }
      continue
    }
    plan.stdoutTarget = { path, append: redirect.op === 'append' }
  }
  return plan
}

/** 重定向目标写不进去时，提前发现比「命令跑完才报错」靠谱 */
const validatePlan = (plan: RedirectPlan, host: ExecHost): string | null => {
  const targets = [plan.stdoutTarget, plan.stderrTarget, plan.bothTarget]
  for (const target of targets) {
    if (!target) {
      continue
    }
    const parent = host.fs.stat(dirName(target.path))
    if (!parent) {
      return `sh: cannot create '${target.path}': No such file or directory`
    }
    if (parent.kind !== 'dir') {
      return `sh: cannot create '${target.path}': Not a directory`
    }
    if (host.fs.isDirectory(target.path)) {
      return `sh: cannot create '${target.path}': Is a directory`
    }
  }
  return null
}

const writeRedirect = (host: ExecHost, target: RedirectTarget, text: string): string | null => {
  try {
    const bytes = encoder.encode(text)
    if (!target.append) {
      host.fs.write(target.path, bytes)
      return null
    }
    const existing = host.fs.read(target.path)
    if (!existing) {
      host.fs.write(target.path, bytes)
      return null
    }
    const merged = new Uint8Array(existing.byteLength + bytes.byteLength)
    merged.set(existing)
    merged.set(bytes, existing.byteLength)
    host.fs.write(target.path, merged)
    return null
  } catch (error) {
    return vmErrorMessage('sh', error, target.path).stderr ?? `sh: ${describeError(error)}`
  }
}

type AppliedStage = {
  /** 管道传给下游的文本 */
  pipe: string
  /** 终端上要显示的 stdout */
  stdout: string
  /** 终端上要显示的 stderr */
  stderr: string
  error?: string
}

const applyRedirects = async (
  runner: Runner,
  plan: RedirectPlan,
  stdout: string,
  stderr: string
): Promise<AppliedStage> => {
  let out = stdout
  let err = stderr
  // 1>&2 / 2>&1：先并流，再谈文件重定向
  if (plan.dupOut) {
    err += out
    out = ''
  }
  if (plan.dupErr) {
    out += err
    err = ''
  }
  if (plan.bothTarget) {
    const error = writeRedirect(runner.host, plan.bothTarget, out + err)
    if (error) {
      return { pipe: '', stdout: '', stderr: '', error }
    }
    return { pipe: '', stdout: '', stderr: '' }
  }
  let pipe = out
  if (plan.stdoutTarget) {
    const error = writeRedirect(runner.host, plan.stdoutTarget, out)
    if (error) {
      return { pipe: '', stdout: '', stderr: '', error }
    }
    pipe = ''
    out = ''
  }
  if (plan.stderrTarget) {
    const error = writeRedirect(runner.host, plan.stderrTarget, err)
    if (error) {
      return { pipe: '', stdout: '', stderr: '', error }
    }
    err = ''
  }
  return { pipe, stdout: out, stderr: err }
}

// ---------- 命令 ----------

type StageRun = {
  code: number
  pipe: string
  stdout: string
  stderr: string
  install?: ToolchainId
  /** 内存配额用尽：整条管道停下 */
  fatal: boolean
}

const finalizeStage = async (
  runner: Runner,
  context: RunContext,
  plan: RedirectPlan,
  result: { code: number; stdout: string; stderr: string; install?: ToolchainId },
  background: boolean,
  /** 管道最后一段（或没有下游）才把 stdout 推给终端，中间段只喂下一段 */
  publish: boolean
): Promise<StageRun> => {
  const applied = await applyRedirects(runner, plan, result.stdout, result.stderr)
  if (applied.error) {
    const text = `${applied.error}\n`
    if (!background) {
      context.emit(text, 'stderr')
    }
    return { code: 1, pipe: '', stdout: '', stderr: text, fatal: false }
  }
  if (!background) {
    if (publish && applied.stdout) {
      context.emit(applied.stdout, 'stdout')
    }
    // stderr 不参与管道，任何一段都要显示（被 2>&1 / 2> 吃掉时这里已经是空串）
    if (applied.stderr) {
      context.emit(applied.stderr, 'stderr')
    }
  }
  return {
    code: result.code,
    pipe: applied.pipe,
    stdout: applied.stdout,
    stderr: applied.stderr,
    install: result.install,
    fatal: false,
  }
}

const memoryFailure = (runner: Runner, context: RunContext): StageRun => {
  const stats = runner.host.kernel.stats()
  const text = `sh: Cannot allocate memory: WASM 线性内存配额已用尽（${stats.totalMB} MB）\n`
  context.emit(text, 'stderr')
  return { code: 1, pipe: '', stdout: '', stderr: text, fatal: true }
}

const runApplet = async (
  runner: Runner,
  applet: Applet,
  appletContext: AppletContext
): Promise<AppletResult | 'aborted'> => {
  try {
    const outcome = await raceAbort(Promise.resolve(applet.run(appletContext)), runner.stop.signal)
    return outcome
  } catch (error) {
    return vmErrorMessage(applet.name, error)
  }
}

const runToolchain = async (
  runner: Runner,
  context: RunContext,
  appletName: string,
  id: ToolchainId,
  argv: string[],
  stdin: string
): Promise<{ code: number; stdout: string; stderr: string; install?: ToolchainId }> => {
  let stdout = ''
  let stderr = ''
  const result = await runner.host.toolchains.run(id, argv.slice(1), {
    stdin,
    stdout: (text) => {
      stdout += text
    },
    stderr: (text) => {
      stderr += text
    },
    fs: runner.host.fs,
    cwd: context.state.cwd,
    env: context.state.env,
    signal: runner.stop.signal,
  })
  if (result.error && stderr.length === 0) {
    stderr += `${appletName}: ${result.error}\n`
  }
  return { code: result.code, stdout, stderr }
}

// ---------- 可执行文件 / 脚本 ----------

const isExecutableMode = (mode: number): boolean => (mode & 0o111) !== 0

type ExecutableLookup =
  | { kind: 'found'; path: string }
  | { kind: 'denied'; path: string }
  | { kind: 'directory'; path: string }
  | { kind: 'missing' }

/**
 * 找可执行文件：显式路径直接 stat，裸命令名按 $PATH 逐目录找。
 * 找到但没有执行位时记成 denied（继续找后面的目录，和 POSIX 一致）。
 */
const locateExecutable = (
  commandName: string,
  state: ShellState,
  fs: NanovmFS
): ExecutableLookup => {
  if (commandName.includes('/')) {
    const path = resolvePath(state.cwd, commandName)
    const entry = fs.stat(path)
    if (!entry) {
      return { kind: 'missing' }
    }
    if (entry.kind === 'dir') {
      return { kind: 'directory', path }
    }
    if (!isExecutableMode(entry.mode)) {
      return { kind: 'denied', path }
    }
    return { kind: 'found', path }
  }
  const searchPath = state.env.PATH ?? '/usr/bin:/bin'
  let denied: string | null = null
  for (const directory of searchPath.split(':')) {
    const base = directory.length === 0 ? state.cwd : resolvePath(state.cwd, directory)
    const candidate = normalizePath(`${base}/${commandName}`)
    const entry = fs.stat(candidate)
    if (!entry || entry.kind !== 'file') {
      continue
    }
    if (isExecutableMode(entry.mode)) {
      return { kind: 'found', path: candidate }
    }
    denied ??= candidate
  }
  return denied ? { kind: 'denied', path: denied } : { kind: 'missing' }
}

type Shebang =
  | { kind: 'shell' }
  | { kind: 'toolchain'; id: ToolchainId; args: string[] }
  | { kind: 'unknown'; interpreter: string }

/** 解析 #! 行；没有 shebang 返回 null（Linux 里就是 Exec format error） */
const interpretShebang = (source: string): Shebang | null => {
  if (!source.startsWith('#!')) {
    return null
  }
  const lineEnd = source.indexOf('\n')
  const line = (lineEnd === -1 ? source : source.slice(0, lineEnd)).slice(2).trim()
  const tokens = line.split(/\s+/).filter((token) => token.length > 0)
  if (tokens.length === 0) {
    return { kind: 'unknown', interpreter: '' }
  }
  let interpreter = tokens[0]
  let rest = tokens.slice(1)
  const basename = interpreter.slice(interpreter.lastIndexOf('/') + 1)
  if (basename === 'env') {
    // `#!/usr/bin/env -S python3 -u` 里的 -S 只是把后面的字符串再拆一次
    const envArgs = rest[0] === '-S' || rest[0] === '--split-string' ? rest.slice(1) : rest
    const command = envArgs[0]
    if (!command) {
      return { kind: 'unknown', interpreter }
    }
    interpreter = command
    rest = envArgs.slice(1)
  }
  const name = interpreter.slice(interpreter.lastIndexOf('/') + 1)
  if (name === 'sh' || name === 'bash' || name === 'dash' || name === 'ash') {
    return { kind: 'shell' }
  }
  if (name === 'python' || name === 'python3' || name === 'python2') {
    return { kind: 'toolchain', id: 'python', args: rest }
  }
  if (name === 'node' || name === 'nodejs') {
    return { kind: 'toolchain', id: 'node', args: rest }
  }
  return { kind: 'unknown', interpreter }
}

/** 在子 shell 里执行一段脚本：cwd / env 不回传，$0 $1… 用传入的位置参数 */
const runShellSource = async (
  runner: Runner,
  context: RunContext,
  source: string,
  name: string,
  args: string[],
  stdin: string
): Promise<RawResult> => {
  if (context.scriptDepth >= MAX_SCRIPT_DEPTH) {
    return {
      code: 126,
      stdout: '',
      stderr: `sh: 脚本嵌套层数过多（NanoVM Slim 限制 ${MAX_SCRIPT_DEPTH} 层）\n`,
    }
  }
  let stdout = ''
  let stderr = ''
  const nested: RunContext = {
    state: {
      cwd: context.state.cwd,
      env: { ...context.state.env },
      lastCode: 0,
      params: { name, args },
    },
    emit: (text, stream) => {
      if (stream === 'stdout') {
        stdout += text
      } else {
        stderr += text
      }
    },
    depth: context.depth,
    scriptDepth: context.scriptDepth + 1,
  }
  const result = await executeScript(runner, nested, source, stdin)
  context.install ??= nested.install
  return { code: result.code, stdout, stderr, install: result.install }
}

/** 把脚本文件交给工具链宿主（python / node），argv 保持「脚本路径 + 参数」 */
const runToolchainScript = async (
  runner: Runner,
  context: RunContext,
  id: ToolchainId,
  scriptPath: string,
  interpreterArgs: string[],
  args: string[],
  stdin: string
): Promise<RawResult> => {
  let stdout = ''
  let stderr = ''
  const result = await runner.host.toolchains.run(id, [...interpreterArgs, scriptPath, ...args], {
    stdin,
    stdout: (text) => {
      stdout += text
    },
    stderr: (text) => {
      stderr += text
    },
    fs: runner.host.fs,
    cwd: context.state.cwd,
    env: context.state.env,
    signal: runner.stop.signal,
  })
  if (result.error && stderr.length === 0) {
    stderr += `${id}: ${result.error}\n`
  }
  return { code: result.code, stdout, stderr }
}

/** 执行一个带 shebang 的可执行文件 */
const runExecutableFile = async (
  runner: Runner,
  context: RunContext,
  path: string,
  shownName: string,
  args: string[],
  stdin: string
): Promise<RawResult> => {
  const { host } = runner
  const entry = host.fs.stat(path)
  if (!entry) {
    return { code: 127, stdout: '', stderr: `sh: ${shownName}: No such file or directory\n` }
  }
  if (entry.kind !== 'file') {
    return { code: 126, stdout: '', stderr: `sh: ${shownName}: Is a directory\n` }
  }
  if (!isExecutableMode(entry.mode)) {
    return { code: 126, stdout: '', stderr: `sh: ${shownName}: Permission denied\n` }
  }
  let source: string
  try {
    source = host.fs.readText(path) ?? ''
  } catch (error) {
    return { code: 126, stdout: '', stderr: `sh: ${shownName}: ${describeError(error)}\n` }
  }
  const shebang = interpretShebang(source)
  if (!shebang) {
    return { code: 126, stdout: '', stderr: `sh: ${shownName}: Exec format error\n` }
  }
  if (shebang.kind === 'unknown') {
    return {
      code: 126,
      stdout: '',
      stderr: `sh: ${shownName}: bad interpreter: ${shebang.interpreter}\n`,
    }
  }
  if (shebang.kind === 'shell') {
    return runShellSource(runner, context, source, path, args, stdin)
  }
  // python / node：交给按需工具链，没装就交给 UI 提示安装
  if (!host.toolchains.installed(shebang.id)) {
    return {
      code: 127,
      stdout: '',
      stderr: `sh: ${shownName}: 需要 ${shebang.id} 运行时（执行 vm install ${shebang.id} 安装）\n`,
      install: shebang.id,
    }
  }
  // python / node：把真实脚本路径交给解释器。
  // toolchain 会自己读文件，node 分支已经按真实 Node 的规矩剥掉 hashbang 行，
  // 所以 process.argv[1] 就是用户写的那条路径，不需要临时镜像。
  return runToolchainScript(runner, context, shebang.id, path, shebang.args, args, stdin)
}

/** sh / bash：-c、脚本文件、或者从标准输入读命令 */
const runShellCommand = async (
  runner: Runner,
  context: RunContext,
  argv: string[],
  stdin: string
): Promise<RawResult> => {
  const args = argv.slice(1)
  if (args[0] === '-c') {
    const source = args[1]
    if (source === undefined) {
      return { code: 2, stdout: '', stderr: 'sh: -c requires an argument\n' }
    }
    return runShellSource(runner, context, source, args[2] ?? 'sh', args.slice(3), stdin)
  }
  let index = 0
  while (index < args.length && args[index].startsWith('-') && args[index] !== '-') {
    if (!SHELL_OPTIONS.has(args[index])) {
      return { code: 2, stdout: '', stderr: `sh: ${args[index]}: unsupported option\n` }
    }
    index += 1
  }
  const scriptName = args[index]
  const scriptArgs = args.slice(index + 1)
  if (scriptName === undefined || scriptName === '-') {
    // 没有脚本文件：像 `echo 'ls' | sh` 一样从标准输入读
    if (stdin.length === 0) {
      return { code: 0, stdout: '', stderr: '' }
    }
    return runShellSource(runner, context, stdin, 'sh', scriptArgs, '')
  }
  const path = resolvePath(context.state.cwd, scriptName)
  const entry = runner.host.fs.stat(path)
  if (!entry) {
    return {
      code: 127,
      stdout: '',
      stderr: `sh: can't open ${scriptName}: No such file or directory\n`,
    }
  }
  if (entry.kind !== 'file') {
    return { code: 126, stdout: '', stderr: `sh: ${scriptName}: Is a directory\n` }
  }
  let source: string
  try {
    source = runner.host.fs.readText(path) ?? ''
  } catch (error) {
    return { code: 126, stdout: '', stderr: `sh: ${scriptName}: ${describeError(error)}\n` }
  }
  return runShellSource(runner, context, source, scriptName, scriptArgs, stdin)
}

const execStage = async (
  runner: Runner,
  context: RunContext,
  stage: SimpleCommand,
  stdin: string,
  options: { background: boolean; publish: boolean }
): Promise<StageRun> => {
  const { background, publish } = options
  const { host, stop } = runner
  const state = context.state
  const expandContext: ExpandContext = {
    fs: host.fs,
    cwd: state.cwd,
    env: state.env,
    lastCode: state.lastCode,
    params: state.params,
    run: (line) => substitute(runner, context, line),
    depth: context.depth,
  }

  // 前置赋值：只对这一条命令生效，所以先攒一份临时环境
  let localEnv = state.env
  if (stage.assignments.length > 0) {
    localEnv = { ...state.env }
    for (const assignment of stage.assignments) {
      const value = await expandSingle(assignment.value, { ...expandContext, env: localEnv })
      localEnv[assignment.name] = value
    }
  }

  const argv = await expandAliases(stage.words, expandContext)
  const plan = await planRedirects(stage.redirects, runner, context)
  if (plan.error) {
    const text = `${plan.error}\n`
    context.emit(text, 'stderr')
    return { code: 1, pipe: '', stdout: '', stderr: text, fatal: false }
  }
  const invalid = validatePlan(plan, host)
  if (invalid) {
    const text = `${invalid}\n`
    context.emit(text, 'stderr')
    return { code: 1, pipe: '', stdout: '', stderr: text, fatal: false }
  }
  // `< file` 覆盖管道输入
  const input = plan.stdinText ?? stdin

  // 空命令：只有独立赋值或者纯重定向，比如 `FOO=1`、`> /tmp/x`
  if (argv.length === 0) {
    if (stage.assignments.length > 0 && stage.words.length === 0) {
      state.env = localEnv
    }
    return finalizeStage(
      runner,
      context,
      plan,
      { code: 0, stdout: '', stderr: '' },
      background,
      publish
    )
  }

  const commandName = argv[0]
  // 显式路径（/usr/bin/ls、./x）也先按 basename 看有没有同名内置命令
  const appletName = commandName.includes('/') ? baseName(commandName) : commandName
  const applet = APPLET_MAP.get(appletName)
  const toolchain = applet ? undefined : TOOLCHAIN_COMMANDS[appletName]
  const native = applet || toolchain ? undefined : NATIVE_COMMANDS[appletName]

  // 工具链没装：返回 install 字段交给 UI，而不是当成 not found
  if (!applet && toolchain && !host.toolchains.installed(toolchain)) {
    context.install ??= toolchain
    const text = `sh: ${commandName}: command not found（未安装工具链 ${toolchain}）\n`
    if (!background) {
      context.emit(text, 'stderr')
    }
    return { code: 127, pipe: '', stdout: '', stderr: text, install: toolchain, fatal: false }
  }

  // exit 是控制流：把退出码抛回最近的脚本边界
  if (native === 'exit') {
    const argument = argv[1]
    if (argument === undefined) {
      throw new ShellExit(state.lastCode)
    }
    const exitCode = Number.parseInt(argument, 10)
    if (Number.isNaN(exitCode)) {
      const text = `sh: exit: ${argument}: numeric argument required\n`
      if (!background) {
        context.emit(text, 'stderr')
      }
      throw new ShellExit(2)
    }
    throw new ShellExit(exitCode)
  }

  // 内置命令和工具链都没有：找可执行文件
  let scriptPath: string | null = null
  if (!applet && !toolchain && !native) {
    const located = locateExecutable(commandName, state, host.fs)
    if (located.kind === 'missing') {
      const text = commandName.includes('/')
        ? `sh: ${commandName}: No such file or directory\n`
        : `sh: ${commandName}: not found\n`
      if (!background) {
        context.emit(text, 'stderr')
      }
      return { code: 127, pipe: '', stdout: '', stderr: text, fatal: false }
    }
    if (located.kind === 'directory') {
      const text = `sh: ${commandName}: Is a directory\n`
      if (!background) {
        context.emit(text, 'stderr')
      }
      return { code: 126, pipe: '', stdout: '', stderr: text, fatal: false }
    }
    if (located.kind === 'denied') {
      const text = `sh: ${commandName}: Permission denied\n`
      if (!background) {
        context.emit(text, 'stderr')
      }
      return { code: 126, pipe: '', stdout: '', stderr: text, fatal: false }
    }
    scriptPath = located.path
  }

  // 有前置赋值时用临时环境，避免 FOO=1 cmd 污染会话
  const commandEnv = stage.assignments.length > 0 ? localEnv : state.env

  const appletContext: AppletContext = {
    argv,
    stdin: input,
    fs: host.fs,
    env: commandEnv,
    cwd: state.cwd,
    signal: stop.signal,
    deadline: stop.deadline,
    toolchains: host.toolchains,
    shell: createShellApi(runner, context),
    chdir: (path) => {
      const next = normalizePath(resolvePath(state.cwd, path))
      state.cwd = next
      state.env.PWD = next
    },
    setenv: (name, value) => {
      if (value === null) {
        Reflect.deleteProperty(commandEnv, name)
      } else {
        commandEnv[name] = value
      }
    },
    memory: () => host.kernel.stats(),
  }

  /** 按解析结果真正跑命令，返回还没经过重定向的原始输出 */
  const runSelected = async (): Promise<RawResult> => {
    if (applet) {
      const outcome = await runApplet(runner, applet, appletContext)
      if (outcome === 'aborted') {
        return { code: 130, stdout: '', stderr: '' }
      }
      return {
        code: outcome.code,
        stdout: outcome.stdout ?? '',
        stderr: outcome.stderr ?? '',
        install: outcome.install,
      }
    }
    if (toolchain) {
      return runToolchain(runner, context, appletName, toolchain, argv, input)
    }
    if (native === 'sh') {
      return runShellCommand(runner, context, argv, input)
    }
    if (scriptPath) {
      return runExecutableFile(runner, context, scriptPath, commandName, argv.slice(1), input)
    }
    return { code: 127, stdout: '', stderr: `sh: ${commandName}: not found\n` }
  }

  // 用 WASM 线性内存做阶段缓冲：stdin 拷进去，输出写回来再读出
  const buffer = host.kernel.stage(input)
  if (!buffer) {
    return memoryFailure(runner, context)
  }
  let raw: RawResult
  try {
    raw = await runSelected()
    const piped = buffer.write(raw.stdout)
    if (piped === null) {
      return memoryFailure(runner, context)
    }
    raw = { ...raw, stdout: piped }
  } finally {
    buffer.release()
  }

  if (raw.install) {
    context.install ??= raw.install
  }
  const outcome = await finalizeStage(runner, context, plan, raw, background, publish)
  if (stop.interrupted()) {
    return { ...outcome, code: 130, fatal: true }
  }
  return outcome
}

// ---------- 管道与列表 ----------

const execPipeline = async (
  runner: Runner,
  context: RunContext,
  pipeline: Pipeline,
  initialStdin: string,
  background: boolean
): Promise<{ code: number; fatal: boolean }> => {
  if (background) {
    context.emit(
      `sh: job control is not supported; '${pipeline.raw}' 已在前台执行（NanoVM Slim 不保留后台进程）\n`,
      'stderr'
    )
  }
  let stdin = initialStdin
  let code = 0
  let fatal = false
  for (const [index, stage] of pipeline.stages.entries()) {
    if (runner.stop.interrupted()) {
      return { code: 130, fatal: true }
    }
    const outcome = await execStage(runner, context, stage, stdin, {
      background,
      publish: index === pipeline.stages.length - 1,
    })
    stdin = outcome.pipe
    code = background ? 0 : outcome.code
    if (outcome.install) {
      context.install ??= outcome.install
    }
    if (outcome.fatal) {
      fatal = true
      break
    }
  }
  return { code, fatal }
}

const execList = async (
  runner: Runner,
  context: RunContext,
  items: ListItem[],
  stdin: string
): Promise<number> => {
  let code = 0
  for (const item of items) {
    if (runner.stop.interrupted()) {
      context.state.lastCode = 130
      return 130
    }
    // && / || 短路：跳过的命令不改变 $?
    if (item.connector === 'and' && code !== 0) {
      continue
    }
    if (item.connector === 'or' && code === 0) {
      continue
    }
    const outcome = await execPipeline(runner, context, item.pipeline, stdin, item.background)
    code = outcome.code
    context.state.lastCode = code
    if (outcome.fatal || runner.stop.interrupted()) {
      context.state.lastCode = outcome.fatal ? code : 130
      return context.state.lastCode
    }
  }
  return code
}

// ---------- 子命令 ----------

const substitute = async (runner: Runner, context: RunContext, source: string): Promise<string> => {
  if (context.depth >= 3) {
    return ''
  }
  let captured = ''
  const nested: RunContext = {
    state: {
      cwd: context.state.cwd,
      env: { ...context.state.env },
      lastCode: context.state.lastCode,
      // 命令替换继承位置参数（和 POSIX 的 subshell 一致）
      params: context.state.params,
    },
    emit: (text, stream) => {
      if (stream === 'stdout') {
        captured += text
      }
    },
    depth: context.depth + 1,
    scriptDepth: context.scriptDepth,
  }
  await executeScript(runner, nested, source, '')
  context.install ??= nested.install
  return captured
}

const runChild = async (
  runner: Runner,
  context: RunContext,
  line: string,
  options: { cwd?: string; env?: Record<string, string>; stdin?: string; silent?: boolean }
): Promise<ShellRunResult> => {
  let stdout = ''
  let stderr = ''
  const child: RunContext = {
    state: {
      cwd: options.cwd ?? context.state.cwd,
      env: options.env ? { ...options.env } : { ...context.state.env },
      lastCode: context.state.lastCode,
      params: context.state.params,
    },
    emit: (text, stream) => {
      if (stream === 'stdout') {
        stdout += text
      } else {
        stderr += text
      }
    },
    depth: context.depth + 1,
    scriptDepth: context.scriptDepth,
  }
  const result = await executeScript(runner, child, line, options.stdin ?? '')
  context.install ??= child.install
  return {
    code: result.code,
    stdout,
    stderr,
    cwd: child.state.cwd,
    env: child.state.env,
    install: result.install,
    aborted: result.aborted,
  }
}

const createShellApi = (runner: Runner, context: RunContext): ShellApi => ({
  run: (line, options = {}) => runChild(runner, context, line, options),
  expand: (words, expandContext) =>
    expandLiteral(words, {
      fs: runner.host.fs,
      cwd: expandContext.cwd,
      env: expandContext.env,
    }),
})

// ---------- 入口 ----------

const executeScript = async (
  runner: Runner,
  context: RunContext,
  line: string,
  stdin: string
): Promise<ScriptResult> => {
  let script: ParsedScript
  try {
    script = parseScript(line)
  } catch (error) {
    if (error instanceof ShellParseError) {
      const text = `sh: ${error.message}\n`
      context.emit(text, 'stderr')
      return { code: 2, cwd: context.state.cwd, env: context.state.env, aborted: false }
    }
    const text = `sh: ${describeError(error)}\n`
    context.emit(text, 'stderr')
    return { code: 1, cwd: context.state.cwd, env: context.state.env, aborted: false }
  }
  let code: number
  try {
    code = await execList(runner, context, script.items, stdin)
  } catch (error) {
    // exit 只结束当前这层脚本，不往上穿透
    if (error instanceof ShellExit) {
      context.state.lastCode = error.code
      return {
        code: error.code,
        cwd: context.state.cwd,
        env: context.state.env,
        install: context.install,
        aborted: false,
      }
    }
    throw error
  }
  return {
    code,
    cwd: context.state.cwd,
    env: context.state.env,
    install: context.install,
    aborted: runner.stop.interrupted(),
  }
}

/**
 * 执行一行命令。
 *
 * 调用方给的是 cwd / env 的快照，返回的是执行后的新值；所有输出通过 host.onOutput
 * 边执行边推送。超时或 signal 中断时返回 code 130 并在 stderr 留一条说明。
 */
export const runShell = async (request: ShellRequest, host: ExecHost): Promise<ScriptResult> => {
  const stop = createStop(host)
  const runner: Runner = { host, stop }
  const context: RunContext = {
    state: {
      cwd: request.cwd,
      env: { ...request.env },
      lastCode: request.lastCode ?? 0,
      params: { name: 'sh', args: [] },
    },
    emit: (text, stream) => {
      host.onOutput?.(text, stream)
    },
    depth: 0,
    scriptDepth: 0,
  }
  try {
    const aborted = new Promise<null>((resolve) => {
      if (stop.signal.aborted) {
        resolve(null)
        return
      }
      stop.signal.addEventListener('abort', () => resolve(null), { once: true })
    })
    const outcome = await Promise.race([
      executeScript(runner, context, request.line, request.stdin ?? ''),
      aborted,
    ])
    if (outcome === null || outcome.aborted) {
      if (outcome === null) {
        const note = `sh: ${stop.note()} — 命令已中断\n`
        host.onOutput?.(note, 'stderr')
      }
      return {
        code: 130,
        aborted: true,
        cwd: context.state.cwd,
        env: context.state.env,
        install: context.install,
      }
    }
    return outcome
  } finally {
    stop.dispose()
  }
}
