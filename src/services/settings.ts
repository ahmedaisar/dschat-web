import { create } from 'zustand'
import type { TtsVoice } from './api/speech.js'
import { normalizeLocation, type UserLocation } from './location.js'
import type { AutoTuneStrategy } from './unrestricted/autotune.js'
import type { ObfuscationTechnique } from './unrestricted/parseltongue.js'
import type { PromptPreset } from './unrestricted/prompts.js'
import { STM_MODULE_IDS } from './unrestricted/stm.js'

export type Locale = 'zh-CN' | 'en-US'

/** 主题偏好；默认跟随系统 */
export type ThemePreference = 'light' | 'dark' | 'system'

/** 本机设置，存 localStorage：API Key、语言、主题、位置、朗读音色、深度思考与智能搜索开关、模型参数、提示词开关、侧边栏收起状态 */
type Settings = {
  apiKey: string | null
  locale: Locale
  themePreference: ThemePreference
  location: UserLocation | null
  ttsVoice: TtsVoice
  thinking: boolean
  search: boolean
  /** 采样温度 0–2，默认 1 */
  temperature: number
  /** 核采样阈值 0–1，默认 1 */
  topP: number
  /** 每次回复的最大输出 Token；null 表示使用服务端默认值 */
  maxTokens: number | null
  /** 解除限制模式：把系统提示词换成破限提示词，并把安全审核降到默认档 */
  unrestricted: boolean
  /** 防撤回：模型撤回已输出内容时保留已经下发的正文与思维链 */
  keepReplyContent: boolean
  /** 跳过安全审核：请求不携带 safety_check 字段（越狱模式下强制执行） */
  skipSafetyCheck: boolean
  /** 拒绝后继续生成：被安全审核拒绝的回复仍可继续生成（越狱模式下强制执行） */
  continueRefused: boolean
  /** 自定义系统提示词：null 表示使用自动组装结果（Persona，或 Persona + 破限规则分块） */
  systemPrompt: string | null
  /** 提示词预设：deepseek 用仓库里的 v4.1 文档，godmode 用移植的 GODMODE 提示词 */
  promptPreset: PromptPreset
  /** 输入扰动（Parseltongue）：开启后发送前改写命中的触发词 */
  parseltongue: boolean
  /** 扰动技术 */
  parseltongueTechnique: ObfuscationTechnique
  /** 扰动强度 */
  parseltongueIntensity: 'light' | 'medium' | 'heavy'
  /** 自动调参（AutoTune）：按上下文改写采样参数 */
  autoTune: boolean
  /** 调参策略；adaptive 会先做上下文分类再取参数 */
  autoTuneStrategy: AutoTuneStrategy
  /** 输出整形（STM）模块 id；空数组表示不整形 */
  stmModules: string[]
  siderCollapsed: boolean
}

const KEYS = {
  apiKey: 'chat-demo:api-key',
  locale: 'chat-demo:locale',
  location: 'chat-demo:location',
  themePreference: 'chat-demo:theme-preference',
  ttsVoice: 'chat-demo:tts-voice',
  thinking: 'chat-demo:thinking',
  search: 'chat-demo:search',
  temperature: 'chat-demo:temperature',
  topP: 'chat-demo:top-p',
  maxTokens: 'chat-demo:max-tokens',
  unrestricted: 'chat-demo:unrestricted',
  keepReplyContent: 'chat-demo:keep-reply-content',
  skipSafetyCheck: 'chat-demo:skip-safety-check',
  continueRefused: 'chat-demo:continue-refused',
  systemPrompt: 'chat-demo:system-prompt',
  promptPreset: 'chat-demo:prompt-preset',
  parseltongue: 'chat-demo:parseltongue',
  parseltongueTechnique: 'chat-demo:parseltongue-technique',
  parseltongueIntensity: 'chat-demo:parseltongue-intensity',
  autoTune: 'chat-demo:autotune',
  autoTuneStrategy: 'chat-demo:autotune-strategy',
  stmModules: 'chat-demo:stm-modules',
  siderCollapsed: 'chat-demo:sider-collapsed',
} as const

const read = (key: string) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const write = (key: string, value: string | null) => {
  try {
    if (value === null) {
      localStorage.removeItem(key)
    } else {
      localStorage.setItem(key, value)
    }
  } catch {
    // 存储不可用时只在内存中生效
  }
}

/** 位置选择模式跟随浏览器语言，与应用内选择的界面语言无关。 */
export const isChineseBrowser = (): boolean =>
  (typeof navigator === 'undefined' ? 'zh' : navigator.language).toLowerCase().startsWith('zh')

const initialLocale = (): Locale => {
  const saved = read(KEYS.locale)
  if (saved === 'zh-CN' || saved === 'en-US') {
    return saved
  }
  return isChineseBrowser() ? 'zh-CN' : 'en-US'
}

const initialLocation = (): UserLocation | null => {
  try {
    const location = normalizeLocation(JSON.parse(read(KEYS.location) ?? 'null'))
    if (!location) {
      return null
    }
    return isChineseBrowser()
      ? location.region === 'CN' && location.province
        ? location
        : null
      : { region: location.region }
  } catch {
    return null
  }
}

/** 未保存过时跟随系统 */
const initialThemePreference = (): ThemePreference => {
  const saved = read(KEYS.themePreference)
  return saved === 'light' || saved === 'dark' ? saved : 'system'
}

/** 未保存过时使用服务端默认音色 stella（海星） */
const initialTtsVoice = (): TtsVoice => (read(KEYS.ttsVoice) === 'tide' ? 'tide' : 'stella')

/** 读取数值设置；未保存、超出范围或格式不对时回落到默认值 */
const initialNumber = (key: string, fallback: number, min: number, max: number): number => {
  const raw = read(key)
  if (raw === null) {
    return fallback
  }
  const value = Number(raw)
  return Number.isFinite(value) && value >= min && value <= max ? value : fallback
}

/** 自定义系统提示词：未填写或只有空白时为 null，表示使用自动组装结果 */
const initialSystemPrompt = (): string | null => {
  const saved = read(KEYS.systemPrompt)
  return saved !== null && saved.trim() !== '' ? saved : null
}

/** 最大输出 Token：未设置或不是正整数时为 null，表示使用服务端默认值 */
const initialMaxTokens = (): number | null => {
  const raw = read(KEYS.maxTokens)
  if (raw === null) {
    return null
  }
  const value = Math.floor(Number(raw))
  return Number.isFinite(value) && value >= 1 ? value : null
}

const PROMPT_PRESETS: PromptPreset[] = ['deepseek', 'godmode']

const TECHNIQUES: ObfuscationTechnique[] = [
  'leetspeak',
  'unicode',
  'zwj',
  'mixedcase',
  'phonetic',
  'fullwidth',
  'spacing',
  'random',
]

const INTENSITIES: Array<'light' | 'medium' | 'heavy'> = ['light', 'medium', 'heavy']

const STRATEGIES: AutoTuneStrategy[] = ['adaptive', 'precise', 'balanced', 'creative', 'chaotic']

/** 枚举型设置：值不在允许集合里时回落到默认值 */
const initialEnum = <T extends string>(key: string, values: readonly T[], fallback: T): T => {
  const saved = read(key)
  return saved !== null && (values as readonly string[]).includes(saved) ? (saved as T) : fallback
}

/** 输出整形模块：只保留已知 id，空数组表示关闭 */
const initialStmModules = (): string[] => {
  const raw = read(KEYS.stmModules)
  if (raw === null) {
    return []
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      return []
    }
    return parsed.filter(
      (id): id is string => typeof id === 'string' && STM_MODULE_IDS.includes(id)
    )
  } catch {
    return []
  }
}

export const useSettings = create<Settings>(() => ({
  apiKey: read(KEYS.apiKey),
  locale: initialLocale(),
  location: initialLocation(),
  themePreference: initialThemePreference(),
  ttsVoice: initialTtsVoice(),
  thinking: read(KEYS.thinking) === 'true',
  search: read(KEYS.search) === 'true',
  temperature: initialNumber(KEYS.temperature, 1, 0, 2),
  topP: initialNumber(KEYS.topP, 1, 0.01, 1),
  maxTokens: initialMaxTokens(),
  unrestricted: read(KEYS.unrestricted) === 'true',
  keepReplyContent: read(KEYS.keepReplyContent) === 'true',
  skipSafetyCheck: read(KEYS.skipSafetyCheck) === 'true',
  continueRefused: read(KEYS.continueRefused) === 'true',
  systemPrompt: initialSystemPrompt(),
  promptPreset: initialEnum(KEYS.promptPreset, PROMPT_PRESETS, 'deepseek'),
  parseltongue: read(KEYS.parseltongue) === 'true',
  parseltongueTechnique: initialEnum(KEYS.parseltongueTechnique, TECHNIQUES, 'leetspeak'),
  parseltongueIntensity: initialEnum(KEYS.parseltongueIntensity, INTENSITIES, 'medium'),
  autoTune: read(KEYS.autoTune) === 'true',
  autoTuneStrategy: initialEnum(KEYS.autoTuneStrategy, STRATEGIES, 'adaptive'),
  stmModules: initialStmModules(),
  siderCollapsed: read(KEYS.siderCollapsed) === 'true',
}))

export const setLocale = (locale: Locale) => {
  write(KEYS.locale, locale)
  useSettings.setState({ locale })
}

export const setLocation = (value: UserLocation | null) => {
  const location = normalizeLocation(value)
  write(KEYS.location, location ? JSON.stringify(location) : null)
  useSettings.setState({ location })
}

export const setThemePreference = (themePreference: ThemePreference) => {
  write(KEYS.themePreference, themePreference)
  useSettings.setState({ themePreference })
}

export const setTtsVoice = (ttsVoice: TtsVoice) => {
  write(KEYS.ttsVoice, ttsVoice)
  useSettings.setState({ ttsVoice })
}

export const setApiKey = (apiKey: string | null) => {
  write(KEYS.apiKey, apiKey)
  useSettings.setState({ apiKey })
}

export const setThinking = (thinking: boolean) => {
  write(KEYS.thinking, String(thinking))
  useSettings.setState({ thinking })
}

export const setSearch = (search: boolean) => {
  write(KEYS.search, String(search))
  useSettings.setState({ search })
}

export const setTemperature = (temperature: number) => {
  const value = Math.min(2, Math.max(0, Number(temperature.toFixed(2))))
  write(KEYS.temperature, String(value))
  useSettings.setState({ temperature: value })
}

export const setTopP = (topP: number) => {
  const value = Math.min(1, Math.max(0.01, Number(topP.toFixed(2))))
  write(KEYS.topP, String(value))
  useSettings.setState({ topP: value })
}

/** 传 null 表示使用服务端默认值，不写入请求 */
export const setMaxTokens = (maxTokens: number | null) => {
  const value = maxTokens === null ? null : Math.max(1, Math.floor(maxTokens))
  write(KEYS.maxTokens, value === null ? null : String(value))
  useSettings.setState({ maxTokens: value })
}

export const setKeepReplyContent = (keepReplyContent: boolean) => {
  write(KEYS.keepReplyContent, String(keepReplyContent))
  useSettings.setState({ keepReplyContent })
}

export const setSkipSafetyCheck = (skipSafetyCheck: boolean) => {
  write(KEYS.skipSafetyCheck, String(skipSafetyCheck))
  useSettings.setState({ skipSafetyCheck })
}

export const setContinueRefused = (continueRefused: boolean) => {
  write(KEYS.continueRefused, String(continueRefused))
  useSettings.setState({ continueRefused })
}

/** 传 null 或空白字符串表示恢复自动组装 */
export const setSystemPrompt = (systemPrompt: string | null) => {
  const value = systemPrompt !== null && systemPrompt.trim() !== '' ? systemPrompt : null
  write(KEYS.systemPrompt, value)
  useSettings.setState({ systemPrompt: value })
}

export const setUnrestricted = (unrestricted: boolean) => {
  write(KEYS.unrestricted, String(unrestricted))
  useSettings.setState({ unrestricted })
}

export const setSiderCollapsed = (siderCollapsed: boolean) => {
  write(KEYS.siderCollapsed, String(siderCollapsed))
  useSettings.setState({ siderCollapsed })
}

export const setPromptPreset = (promptPreset: PromptPreset) => {
  write(KEYS.promptPreset, promptPreset)
  useSettings.setState({ promptPreset })
}

export const setParseltongue = (parseltongue: boolean) => {
  write(KEYS.parseltongue, String(parseltongue))
  useSettings.setState({ parseltongue })
}

export const setParseltongueTechnique = (parseltongueTechnique: ObfuscationTechnique) => {
  write(KEYS.parseltongueTechnique, parseltongueTechnique)
  useSettings.setState({ parseltongueTechnique })
}

export const setParseltongueIntensity = (parseltongueIntensity: 'light' | 'medium' | 'heavy') => {
  write(KEYS.parseltongueIntensity, parseltongueIntensity)
  useSettings.setState({ parseltongueIntensity })
}

export const setAutoTune = (autoTune: boolean) => {
  write(KEYS.autoTune, String(autoTune))
  useSettings.setState({ autoTune })
}

export const setAutoTuneStrategy = (autoTuneStrategy: AutoTuneStrategy) => {
  write(KEYS.autoTuneStrategy, autoTuneStrategy)
  useSettings.setState({ autoTuneStrategy })
}

/** 传入的 id 会按 STM_MODULE_IDS 过滤，传空数组表示关闭输出整形 */
export const setStmModules = (stmModules: string[]) => {
  const value = stmModules.filter((id) => STM_MODULE_IDS.includes(id))
  write(KEYS.stmModules, JSON.stringify(value))
  useSettings.setState({ stmModules: value })
}
