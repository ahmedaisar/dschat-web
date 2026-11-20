import { useSettings, type CustomProvider } from '../settings.js'

/**
 * 自定义 OpenAI 兼容提供商（BYOK）：端点根地址、Key 与模型都由用户提供，
 * 存在本机 localStorage，仅在浏览器里使用，构建期地址 __API_ORIGIN__ 与此无关。
 */

/** 当前生效的自定义提供商：设置为 custom 且配置完整时返回，否则为 null（走内置 DeepSeek） */
export const getCustomProvider = (): CustomProvider | null => {
  const { provider, customProvider } = useSettings.getState()
  return provider === 'custom' ? customProvider : null
}

/** 是否以自定义 OpenAI 兼容提供商发送请求 */
export const isCustomProviderEnabled = (): boolean => getCustomProvider() !== null

/** 是否使用官方 ChatGPT 订阅连接；令牌只在 Vercel HttpOnly 会话中保存 */
export const isChatGPTProviderEnabled = (): boolean => useSettings.getState().provider === 'chatgpt'

/**
 * 拼接端点路径：根地址可以带或不带 /v1（如 https://api.openai.com/v1 或 https://host/v1）。
 * 已以 /v1 结尾时不再重复添加。
 */
export const joinOpenAIUrl = (baseURL: string, path: string): string => {
  const base = baseURL.replace(/\/+$/, '')
  const suffix = path.replace(/^\/+/, '')
  return /\/v1$/.test(base) ? `${base}/${suffix}` : `${base}/v1/${suffix}`
}

/** POST /v1/chat/completions（流式） */
export const chatCompletionsUrl = (baseURL: string): string =>
  joinOpenAIUrl(baseURL, 'chat/completions')

/** GET /v1/models */
export const modelsUrl = (baseURL: string): string => joinOpenAIUrl(baseURL, 'models')
