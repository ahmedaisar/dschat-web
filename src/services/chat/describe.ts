import { isTranslationKey, translate } from '../../i18n/index.js'
import { classifyStatus, isAgenticHarnessMessage, retryAfterSeconds } from '../api/errors.js'
import { isCustomProviderEnabled } from '../api/provider.js'
import { hasReplyContent } from './reply.js'
import type { AssistantMessage } from './types.js'

export type Notice = {
  text: string
  /** 模板答复使用正文样式；其余统一为红色错误提示。 */
  presentation?: 'response'
  /** 需要用户处理的问题附带的操作 */
  action?: 'apiKey' | 'topUp'
}

const getTemplateText = (reply: AssistantMessage) =>
  reply.blocks
    .map((block) => (block.type === 'text' && block.isTemplate ? block.text : ''))
    .join('')

/** 回复出错或未正常结束时展示的提示 */
export const describeReply = (reply: AssistantMessage): Notice | null => {
  if (reply.status === 'error' && reply.error) {
    const { kind, status, localMessage } = reply.error
    // 导入的历史可能来自不同版本；不识别的文案沿用保存时的原文。
    const message =
      localMessage && isTranslationKey(localMessage.key)
        ? translate(localMessage.key, localMessage.params)
        : reply.error.message
    // 历史补传错误刷新后仍需说明原因，恢复沿用附件卡片或重新生成。
    if (kind === 'upload') {
      return { text: message || translate('uploadFileStatusFailed') }
    }
    if (kind === 'network') {
      return { text: translate('commonNetworkErrorToast') }
    }
    const custom = isCustomProviderEnabled()
    switch (classifyStatus(status)) {
      case 'unauthorized':
        return { text: translate('replyInvalidApiKey'), action: 'apiKey' }
      case 'insufficientBalance':
        // 自定义提供商时不跳转 DeepSeek 的充值页（付款方不同），只给出文案
        return custom
          ? { text: translate('replyInsufficientBalance') }
          : { text: translate('replyInsufficientBalance'), action: 'topUp' }
      case 'rateLimited':
        if (custom) {
          const seconds = retryAfterSeconds(reply.error.retryAfter)
          return {
            text:
              seconds !== null
                ? translate('replyRateLimitedRetryAfter', { seconds })
                : translate('replyRateLimitedCustom'),
          }
        }
        return { text: translate('replyRateLimited') }
      case 'serverBusy':
        return { text: translate('completionServerBusyToast') }
      default:
        // OpenRouter 把个别 :free 型号限定给智能体客户端用（403）：不依赖状态码，只按文案识别
        if (isAgenticHarnessMessage(reply.error.message)) {
          return { text: translate('agenticHarnessOnlyModel') }
        }
        return message ? { text: message } : null
    }
  }
  const template = getTemplateText(reply)
  // 归档不带结构化错误，错误文案保存在模板中，仍按错误提示展示。
  if (reply.status === 'error' && template) {
    return { text: template }
  }
  if (reply.stopReason === 'refusal') {
    // 防撤回保留了已下发内容时不再用模板替换正文，只提示本轮被撤回。
    if (hasReplyContent(reply)) {
      return { text: translate('replyRefusalKept') }
    }
    // 导入的拒绝回复优先展示归档中的模板，普通正文仍不可展示。
    return { text: template || translate('replyRefused'), presentation: 'response' }
  }
  if (template) {
    return { text: template, presentation: 'response' }
  }
  return null
}
