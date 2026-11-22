import { create } from 'zustand'

/**
 * 聊天模式：控制「模型这一轮能用哪些客户端工具」。
 *
 * 四种模式参考 DeepSeek Harness 的分层：
 * - `chat`    仅聊天：不下发任何客户端工具，模型只能用服务端搜索 / 读链接；
 * - `web`     网页 Agent：浏览器工具 + 虚拟工作区工具；
 * - `ptc`     PTC：再加上 NanoVM Slim，允许一轮里批量调用、并发执行、多轮往返；
 * - `creator` 创造：在 PTC 基础上允许模型自己装运行时、把脚本写成虚拟机里的新命令
 *             （虚拟机里的写操作与安装不再逐次确认）。
 *
 * 模式只做「再加一道限制」，不越过设置里的主开关与逐项开关：
 * 关掉的工具即使模式允许也不会下发。
 */

export type ChatMode = 'chat' | 'web' | 'ptc' | 'creator'

/** 工具分组：与设置页的三个分组对应 */
export type ToolGroup = 'browser' | 'workspace' | 'nanovm'

export type ModePolicy = {
  mode: ChatMode
  /** 允许下发的工具分组；空数组表示一个都不给 */
  groups: ToolGroup[]
  /** 一轮回复里客户端工具往返的最大次数 */
  maxRounds: number
  /** 同一轮里的多个工具调用是否并发执行 */
  parallel: boolean
  /** 创造模式：虚拟机里的写操作与安装不再逐次确认 */
  autoApproveVm: boolean
}

const POLICIES: Record<ChatMode, Omit<ModePolicy, 'mode'>> = {
  chat: { groups: [], maxRounds: 4, parallel: false, autoApproveVm: false },
  web: { groups: ['browser', 'workspace'], maxRounds: 8, parallel: false, autoApproveVm: false },
  ptc: {
    groups: ['browser', 'workspace', 'nanovm'],
    maxRounds: 16,
    parallel: true,
    autoApproveVm: false,
  },
  creator: {
    groups: ['browser', 'workspace', 'nanovm'],
    maxRounds: 24,
    parallel: true,
    autoApproveVm: true,
  },
}

const KEY = 'chat-demo:chat-mode'

const read = (): ChatMode => {
  try {
    const raw = localStorage.getItem(KEY)
    return raw === 'chat' || raw === 'web' || raw === 'ptc' || raw === 'creator' ? raw : 'web'
  } catch {
    return 'web'
  }
}

export const useChatMode = create<{ mode: ChatMode }>(() => ({ mode: read() }))

export const chatMode = (): ChatMode => useChatMode.getState().mode

export const modePolicy = (mode = chatMode()): ModePolicy => ({ mode, ...POLICIES[mode] })

export const setChatMode = (mode: ChatMode) => {
  try {
    localStorage.setItem(KEY, mode)
  } catch {
    // 隐私模式下写不进去也不影响本次会话
  }
  useChatMode.setState({ mode })
}

/** 某个工具分组在当前模式下是否可用 */
export const modeAllowsGroup = (group: ToolGroup, mode = chatMode()): boolean =>
  POLICIES[mode].groups.includes(group)

/** 模式的展示顺序，输入栏与设置页共用 */
export const CHAT_MODES: ChatMode[] = ['chat', 'web', 'ptc', 'creator']

/**
 * 追加到 system 末尾的能力说明：让模型知道这一轮自己能用什么，
 * 避免在仅聊天模式里反复尝试调用工具。仅聊天模式没有工具，不加。
 */
export const modeSystemNote = (mode = chatMode()): string => {
  if (mode === 'chat') {
    return ''
  }
  const notes: Record<Exclude<ChatMode, 'chat'>, { en: string }> = {
    web: {
      en: 'Current mode: Web agent. Browser tools and the virtual workspace are available. The VM and shell are not.',
    },
    ptc: {
      en: 'Current mode: PTC. You may batch tool calls: browser tools, the virtual workspace and NanoVM Slim (shell, files, on-demand runtimes). Several tools can run in parallel within one round and build on each other.',
    },
    creator: {
      en: 'Current mode: Creator. On top of PTC you may install runtimes inside NanoVM Slim (vm install python / node / git), write scripts into /usr/bin or any PATH directory, chmod +x them and reuse them as new commands. VM writes and installs no longer ask for confirmation — be careful.',
    },
  }
  const note = notes[mode]
  return note.en
}
