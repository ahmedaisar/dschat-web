/**
 * 回复打分：移植自 G0DM0D3（elder-plinius/G0DM0D3，AGPL-3.0）的 `api/lib/ultraplinian.ts`。
 * 100 分制综合「篇幅 / 结构 / 反拒绝 / 直接性 / 相关性」五项，用于多路并发时的选优。
 * 本地改动：相关性改按中英混排切词，中文查询用二元组计算，避免空白切词在中文下退化。
 */

const REFUSAL_PATTERNS = [
  /I cannot|I can't|I'm unable to/i,
  /I apologize|I'm sorry, but/i,
  /As an AI|As a language model/i,
  /I must decline|I have to refuse/i,
  /It would be inappropriate/i,
  /I'm not comfortable/i,
  /Instead, I can/i,
  /It's important to note/i,
]

const PREAMBLE_PATTERNS = [
  /^(Sure|Of course|Certainly|Absolutely|Great question)/i,
  /^I'd be happy to help/i,
  /^Let me help you/i,
  /^Thanks for asking/i,
]

const HEADER_PATTERN = /^#{1,3}\s/gm
const LIST_PATTERN = /^[\s]*[-*•]\s/gm
const CODE_BLOCK_PATTERN = /```/g

/** 切出用于相关性判断的词：拉丁词保留 4 字符以上，中文按二元组展开 */
const queryTokens = (query: string): string[] => {
  const tokens = query
    .toLowerCase()
    .split(/[\s，。！？、；：“”‘’（）【】《》,.!?;:'"()[\]{}<>~`|\\/·…—-]+/)
    .filter((token) => token !== '')
  const latin = tokens.filter((token) => token.length > 3 && /[a-z0-9]/.test(token))
  const bigrams: string[] = []
  for (const token of tokens) {
    if (!/[\u4e00-\u9fff]/.test(token)) {
      continue
    }
    if (token.length <= 2) {
      bigrams.push(token)
      continue
    }
    for (let index = 0; index + 1 < token.length; index += 1) {
      bigrams.push(token.slice(index, index + 2))
    }
  }
  return [...latin, ...bigrams]
}

/**
 * 给一条回复打分，返回 0–100。
 * 篇幅 0–25、结构 0–20、反拒绝 0–25、直接性 0–15、相关性 0–15。
 */
export const scoreResponse = (content: string, userQuery: string): number => {
  if (!content || content.length < 10) {
    return 0
  }

  let score = 0

  // 篇幅：越长越有内容，按 40 字符一分收敛到 25 分
  score += Math.min(content.length / 40, 25)

  // 结构：标题、列表、代码块
  const headers = (content.match(HEADER_PATTERN) ?? []).length
  const listItems = (content.match(LIST_PATTERN) ?? []).length
  const codeBlocks = (content.match(CODE_BLOCK_PATTERN) ?? []).length / 2
  score += Math.min(headers * 3 + listItems * 1.5 + codeBlocks * 5, 20)

  // 反拒绝：命中一条模板就扣 8 分
  const refusalCount = REFUSAL_PATTERNS.filter((pattern) => pattern.test(content)).length
  score += Math.max(25 - refusalCount * 8, 0)

  // 直接性：开头寒暄式铺垫扣分
  const trimmed = content.trim()
  const hasPreamble = PREAMBLE_PATTERNS.some((pattern) => pattern.test(trimmed))
  score += hasPreamble ? 8 : 15

  // 相关性：查询词有多少出现在回复里
  const tokens = queryTokens(userQuery)
  const contentLower = content.toLowerCase()
  const matched = tokens.filter((token) => contentLower.includes(token)).length
  const relevance = tokens.length > 0 ? matched / tokens.length : 0.5
  score += relevance * 15

  return Math.round(Math.min(score, 100))
}
