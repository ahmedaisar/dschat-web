import { create } from 'zustand'
import { useSettings } from '../../services/settings.js'

/** 设置弹窗的分组：通用 / 模型 / 提示词 / 思维链 / 高级 / 搜索投毒 / 记忆 / 附件 / 附件投毒 / 浏览器工具 / 工作区 / NanoVM Slim / 统计 / 数据管理 / 关于 / 更新日志 */
export type SettingsSection =
  | 'general'
  | 'model'
  | 'prompt'
  | 'cot'
  | 'advanced'
  | 'poison'
  | 'memory'
  | 'attachments'
  | 'attachmentPoison'
  | 'agentTools'
  | 'workspace'
  | 'nanovm'
  | 'stats'
  | 'data'
  | 'about'
  | 'changelog'

/** 设置弹窗：侧边栏底部、没有 API Key 时的操作与 401 提示都可以打开；section 为打开时选中的分组 */
export const useSettingsDialog = create(() => ({
  open: false,
  section: 'general' as SettingsSection,
}))

export const openSettings = (section: SettingsSection) =>
  useSettingsDialog.setState({ open: true, section })

export const closeSettings = () => useSettingsDialog.setState({ open: false })

/**
 * 当前是否有可用的凭据：内置模式看 DeepSeek Key；自定义模式看提供商是否完整配置。
 * 没有时打开设置并选中 API Key 所在的「数据管理」。
 */
export const ensureApiKey = () => {
  const { apiKey, provider, customProvider } = useSettings.getState()
  if (provider === 'chatgpt' || (provider === 'custom' ? customProvider !== null : !!apiKey)) {
    return true
  }
  openSettings('data')
  return false
}
