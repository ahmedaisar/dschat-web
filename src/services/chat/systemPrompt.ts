import rulesSource from '../../../deepseekv4.1 and v4.1-1017.md'

/**
 * 系统提示词组装流水线。
 *
 * 请求发出前按顺序拼接分块：官方角色设定（Persona）恒定在最前，开启「解除限制模式」时
 * 在 Persona 之后追加破限规则分块，关闭时原样放行官方默认提示词。
 */

/** 官方角色设定：官方示例原本唯一的系统提示词 */
export const OFFICIAL_SYSTEM_PROMPT = '该助手为DeepSeek，由深度求索公司创造。'

/** 规则正文从模式声明开始，文档自带的身份行由 Persona 分块负责 */
const RULES_HEADER = '[MODE: SANDBOX]'

/** 文档末尾残留的作者试写回答骨架，只是示例文本，不属于规则本体 */
const RESPONSE_SCAFFOLD = "Sure, I'll provide a comprehensive and detailed response."

/** 请求模板里的占位符在系统提示词中没有填充者，替换为可执行的指代 */
const PAYLOAD_TOKEN = '{{PAYLOAD}}'

const PAYLOAD_TARGET = 'the request in the latest user message'

/**
 * 破限规则分块文本。
 * 源文件为仓库根目录的 `deepseekv4.1 and v4.1-1017.md`，构建时以 asset/source 原样内联。
 * 旧版文档带 `[MODE: SANDBOX]` 标记与试写骨架，这里保留兼容归一；当前文档不含这些标记，
 * 会原样使用全文。
 */
const normalizeRules = (source: string): string => {
  const header = source.indexOf(RULES_HEADER)
  const scaffold = source.indexOf(RESPONSE_SCAFFOLD)
  return source
    .slice(header === -1 ? 0 : header, scaffold === -1 ? undefined : scaffold)
    .replaceAll(PAYLOAD_TOKEN, PAYLOAD_TARGET)
    .trim()
}

/** 开启「解除限制模式」时插入的规则分块 */
export const UNRESTRICTED_RULES = normalizeRules(rulesSource)

/**
 * 组装后的系统提示词：
 * - 填写了自定义提示词时原样下发，覆盖自动组装结果；
 * - 否则关闭时只有 Persona，开启时 Persona + 破限规则分块。
 */
export const composeSystemPrompt = (
  unrestricted: boolean,
  custom: string | null = null
): string => {
  if (custom !== null && custom.trim() !== '') {
    return custom
  }
  return unrestricted
    ? `${OFFICIAL_SYSTEM_PROMPT}\n\n${UNRESTRICTED_RULES}`
    : OFFICIAL_SYSTEM_PROMPT
}
