import clsx from 'clsx'
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react'
import { useTranslate } from '../../i18n/index.js'
import { IconTerminalOutline16 } from '../base/icons.js'
import { showToast } from '../base/toastState.js'
import { useEngine } from '../../services/nanovm/boot.js'
import { installToolchain, usePackages } from '../../services/nanovm/packages.js'
import {
  browseHistory,
  interruptNanoVM,
  promptFor,
  shortPath,
  submitNanoVMCommand,
  type ShellLine,
  type ShellTab,
} from '../../services/nanovm/session.js'
import type { ToolchainId } from '../../services/nanovm/types.js'
import styles from './NanoVM.module.css'

/** 输入框的操作入口：手机端的键盘 / 全屏按钮要用 */
export type TerminalInputApi = {
  focus: () => void
  /** 已聚焦则收起键盘，否则弹出键盘 */
  toggleKeyboard: () => void
}

/** 每种输出行对应的颜色 */
const LINE_CLASS: Record<ShellLine['kind'], string> = {
  input: styles.lineInput,
  stdout: styles.lineStdout,
  stderr: styles.lineStderr,
  info: styles.lineInfo,
  error: styles.lineError,
}

/** 缺工具链时的安装条：显示进度，装完后由 shell 清空 tab.pendingInstall */
const PendingInstall = ({ id }: { id: ToolchainId }) => {
  const t = useTranslate()
  const state = usePackages((store) => store.states[id])
  const busy = usePackages((store) => store.busy === id)
  const [installing, setInstalling] = useState(false)
  const pending = busy || installing
  const percent = Math.round(Math.min(1, Math.max(0, state?.progress ?? 0)) * 100)
  const label = state?.label ?? id

  const install = async () => {
    setInstalling(true)
    try {
      const result = await installToolchain(id)
      if (!result.ok) {
        showToast({
          key: 'nanovmInstallFailed',
          params: { reason: result.error ?? label },
          type: 'error',
        })
      }
    } finally {
      setInstalling(false)
    }
  }

  return (
    <div className={styles.install}>
      <div className={styles.installRow}>
        <span className={styles.installText}>{t('nanovmNeedRuntime', { name: label })}</span>
        {pending ? (
          <span className={styles.installProgress}>{t('nanovmInstalling', { percent })}</span>
        ) : null}
        <button
          type="button"
          className={styles.installButton}
          disabled={pending}
          onClick={() => void install()}
        >
          {t('nanovmInstallNow')}
        </button>
      </div>
      {pending ? (
        <div className={styles.installBar} aria-hidden>
          <span style={{ width: `${percent}%` }} />
        </div>
      ) : null}
    </div>
  )
}

/**
 * 终端主体：输出区 + 输入行，桌面停靠与手机面板共用。
 *
 * 输出贴底但在用户往上翻过之后不再抢滚动位置；输入行支持 Enter 执行、
 * ↑↓ 翻历史、Ctrl+C 中断，运行中的命令不允许重复提交。
 */
export const TerminalView = ({
  tab,
  compact = false,
  renderInputActions,
}: {
  tab: ShellTab
  /** 手机端：提示符用 ~ $ 的短形式，输入行更窄 */
  compact?: boolean
  /** 输入行右侧的额外按钮 */
  renderInputActions?: (api: TerminalInputApi) => ReactNode
}) => {
  const t = useTranslate()
  const applets = useEngine((store) => store.info?.applets ?? 0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const stickRef = useRef(true)
  const [draft, setDraft] = useState('')

  // 切换标签时回到「跟随最新输出」
  useEffect(() => {
    stickRef.current = true
  }, [tab.id])

  // 有新输出就贴底；往上翻过之后 stickRef 为 false，不打扰用户看历史
  useEffect(() => {
    const element = scrollRef.current
    if (!element || !stickRef.current) {
      return
    }
    element.scrollTop = element.scrollHeight
  }, [tab.id, tab.lines])

  const focusInput = () => inputRef.current?.focus()

  /**
   * 点输出区任意位置（输出行、空状态、空白处）都把焦点交给命令行：
   * 手机端点一下就能弹键盘，桌面端也不用再点底部那一行。
   * 拖着选中文本时不抢焦点（方便复制），点在按钮 / 链接上保留原行为。
   */
  const focusFromOutput = (event: MouseEvent<HTMLDivElement>) => {
    if (
      event.target instanceof Element &&
      event.target.closest('button, a, input, textarea, select')
    ) {
      return
    }
    if (window.getSelection()?.toString()) {
      return
    }
    stickRef.current = true
    const element = scrollRef.current
    if (element) {
      element.scrollTop = element.scrollHeight
    }
    inputRef.current?.focus()
  }

  const toggleKeyboard = () => {
    const input = inputRef.current
    if (!input) {
      return
    }
    if (document.activeElement === input) {
      input.blur()
    } else {
      input.focus()
    }
  }

  /** 只有非空且没有命令在跑时才提交，草稿交给调用方清理 */
  const submit = (line: string) => {
    const value = line.trim()
    if (!value || tab.running) {
      return
    }
    stickRef.current = true
    void submitNanoVMCommand(value)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // 输入法组合中的回车交给输入法
    if (event.nativeEvent.isComposing) {
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      if (tab.running) {
        return
      }
      const value = draft
      setDraft('')
      submit(value)
      return
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault()
      setDraft(browseHistory(event.key === 'ArrowUp' ? 'up' : 'down'))
      return
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') {
      const input = event.currentTarget
      // 输入框里有选区时保留浏览器自己的复制行为
      if (input.selectionStart !== input.selectionEnd) {
        return
      }
      event.preventDefault()
      interruptNanoVM()
    }
  }

  const prompt = compact ? `${shortPath(tab.cwd)} $` : promptFor(tab)

  return (
    <div className={styles.terminal}>
      <div
        ref={scrollRef}
        className={styles.output}
        role="log"
        aria-label={t('nanovm')}
        onScroll={() => {
          const element = scrollRef.current
          if (!element) {
            return
          }
          stickRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 40
        }}
        onClick={focusFromOutput}
      >
        {tab.lines.length === 0 ? (
          <div className={styles.empty}>
            <span className={styles.emptyIcon}>
              <IconTerminalOutline16 />
            </span>
            <div>{t('nanovmEmpty', { count: applets })}</div>
            <button
              type="button"
              className={styles.emptyHelp}
              onClick={() => {
                stickRef.current = true
                void submitNanoVMCommand('help')
              }}
            >
              help
            </button>
          </div>
        ) : (
          tab.lines.map((line) => (
            <div key={line.id} className={clsx(styles.line, LINE_CLASS[line.kind])}>
              {line.kind === 'input' ? (
                <>
                  <span className={styles.linePrompt}>{line.prompt ?? promptFor(tab)}</span>{' '}
                  {line.text}
                </>
              ) : (
                line.text
              )}
              {line.stream ? <span className={styles.caret} aria-hidden /> : null}
            </div>
          ))
        )}
      </div>
      {tab.pendingInstall ? <PendingInstall id={tab.pendingInstall} /> : null}
      {/*
        手机输入法的「发送 / 前往」键在 Android WebView 里只会触发 form submit，
        不会派发 keydown 的 Enter（isComposing 还是 true），所以外面必须包一层 form，
        否则真机上只有硬件回车能提交。
      */}
      <form
        className={styles.inputRow}
        onSubmit={(event) => {
          event.preventDefault()
          if (tab.running) {
            return
          }
          const value = draft
          setDraft('')
          submit(value)
        }}
      >
        <span className={styles.inputPrompt} title={prompt}>
          {prompt}
        </span>
        <input
          ref={inputRef}
          className={styles.input}
          value={draft}
          placeholder={t('nanovmPlaceholder')}
          aria-label={t('nanovmPlaceholder')}
          enterKeyHint="send"
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
        />
        {tab.running ? <span className={styles.spinner} aria-hidden /> : null}
        {renderInputActions?.({ focus: focusInput, toggleKeyboard })}
      </form>
    </div>
  )
}
