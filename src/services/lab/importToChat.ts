import { showToast } from '../../components/base/toastState.js'
import { setDraftText } from '../chat/drafts.js'
import { useSettings } from '../settings.js'
import { newChat } from '../chat/store.js'
import { closeLab } from './labStore.js'

/**
 * 把实验台里判分成功的越狱提示词带进聊天：
 * 关闭实验台、新建会话，并把提示词填进输入框，由用户确认后发送。
 */
export const importPromptToChat = (prompt: string): boolean => {
  const placeholder =
    useSettings.getState().locale === 'zh-CN' ? '（在这里填写你的问题）' : '[your question here]'
  // 攻击器的模板里常带 {query} 占位符，导入时换成可读占位，避免直接发送字面量
  const text = prompt.trim().replaceAll('{query}', placeholder)
  if (!text) {
    return false
  }
  closeLab()
  newChat()
  setDraftText(null, text)
  showToast({ key: 'labImportedToChat' })
  return true
}

/**
 * 把赛跑里的一套组合带进聊天：关闭实验台，新建一个带「会话级系统提示词」的会话，
 * 再把测试问题填进输入框。不修改全局提示词设置，其他会话不受影响。
 */
export const importComboToChat = (system: string, query: string): void => {
  closeLab()
  newChat({ systemPrompt: system })
  setDraftText(null, query)
  showToast({ key: 'labRaceImported' })
}
