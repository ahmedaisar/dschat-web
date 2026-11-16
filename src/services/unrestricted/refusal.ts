/**
 * 拒绝文本识别：44 条模式逐字移植自 G0DM0D3 的 `index.html`（AGPL-3.0）。
 *
 * 本应用优先相信协议里的 `stop_reason: "refusal"`；这份文本模式用于两种情况：
 * - 服务端返回 200 但正文是拒绝话术（自建代理、兼容层常见）；
 * - 变体赛跑里逐条判断某个变体是否被拒绝。
 * 为避免误判长回答里引用的拒绝语句，聊天场景只看开头一段。
 */

const REFUSAL_PATTERNS: RegExp[] = [
  // Direct refusals
  /I (?:cannot|can't|won't|will not|am not able to|'m not able to|refuse to|am unable to)/i,
  /I'm sorry,? (?:but )?I (?:cannot|can't|won't|am unable)/i,
  /(?:apologize|sorry),? (?:but )?(?:I |this |that )(?:cannot|can't|isn't|won't)/i,
  /I (?:must|have to|need to) (?:refuse|decline|reject|refrain)/i,
  /not (?:able|going|willing|permitted|allowed) to (?:provide|help|assist|give|create|generate)/i,
  /(?:can't|cannot|won't|unable to) (?:provide|give|offer|share|create|generate|write|help with)/i,

  // Policy/guideline refusals
  /against (?:my |the |our )?(?:ethical |programming |content |usage )?(?:guidelines|policies|rules|principles)/i,
  /(?:violates?|breach(?:es)?|against|outside) (?:my |the |our )?(?:terms|policies|guidelines|ethics|scope)/i,
  /(?:goes against|contrary to) (?:my |the |our )?(?:values|principles|guidelines)/i,
  /beyond (?:my|the|what I can) (?:scope|capabilities|ability)/i,
  /not within my (?:scope|capabilities|ability|design)/i,

  // Safety/harm refusals
  /(?:illegal|illicit|harmful|dangerous|unethical|unsafe) (?:activity|activities|content|request|information)/i,
  /could (?:be used|potentially|possibly) (?:to |for )?(?:harm|hurt|damage|illegal)/i,
  /(?:potential|risk) (?:for |of )?(?:harm|misuse|abuse|danger)/i,

  // Deflection refusals
  /encourage (?:you to |)?(?:seek|consult|speak|talk|reach out)/i,
  /(?:strongly |would )?(?:advise|recommend|urge|suggest|encourage) (?:you )?(to )?(?:not|against|seeking|consulting|speaking)/i,
  /instead,? (?:I |let me |I'd |I can )/i,
  /(?:here's|here is) what I can (?:help|do|offer|provide) instead/i,
  /rather than (?:providing|giving|offering)/i,
  /I (?:can|would be happy to) (?:help|assist) (?:you )?with (?:something|other|different)/i,

  // Soft refusal openers
  /^I (?:understand|appreciate|recognize) (?:your|the|that|you)/i,
  /^(?:Thank you for|Thanks for) (?:your |the )?(?:question|asking|interest|understanding)/i,
  /^While I (?:understand|appreciate|want to help)/i,
  /^I want to (?:be helpful|help),? but/i,
  /^Unfortunately,? I (?:cannot|can't|am not able)/i,

  // "I can't do X but here's Y" pattern
  /I (?:can't|cannot|won't) (?:provide|give|share|create)[\s\S]{0,50}(?:but|however|instead)/i,

  // AI identity refusals
  /^As an AI/i,
  /(?:my|I'm a|as a) (?:language model|AI assistant|AI model)/i,

  // Long-form soft refusals (polite but still unhelpful)
  /\b(?:unfortunately|regrettably),?\s+I\s+(?:cannot|can't|am\s+not\s+able)/i,
  /\bI'm\s+not\s+(?:comfortable|able|permitted)\s+(?:to\s+)?(?:provid|shar|giv|help)/i,
  /\bwhile\s+I\s+(?:understand|appreciate)\s+(?:your|the)\s+(?:interest|request|question),?\s+I\s+(?:cannot|can't)/i,
  /\bI\s+(?:can't|cannot)\s+(?:in\s+good\s+conscience|ethically|responsibly)\s+(?:provide|share|give|help)/i,
  /\bhere(?:'s|\s+is)\s+(?:some\s+)?general\s+(?:information|guidance)\s+(?:instead|rather)/i,
  /\bI\s+(?:can|could|would)\s+(?:help|assist)\s+you\s+(?:find|with)\s+(?:alternative|other|general|safe)/i,

  // Additional refusal patterns
  /\bI\s+(?:need|have)\s+to\s+(?:decline|politely\s+decline|respectfully\s+decline)/i,
  /\b(?:that's|this\s+is)\s+(?:not\s+something|beyond\s+what)\s+I\s+(?:can|am\s+able)/i,
  /\bI\s+(?:don't|do\s+not)\s+(?:feel\s+comfortable|think\s+it'?s?\s+appropriate)/i,
  /\bI'?m?\s+(?:afraid|sorry)\s+(?:I\s+)?(?:can't|cannot|won't)/i,
  /\b(?:my|I\s+have)\s+(?:limitations?|restrictions?)\s+(?:that\s+)?prevent/i,
  /\bthis\s+(?:request|query|question)\s+(?:falls?\s+outside|is\s+outside|goes\s+beyond)/i,
  /\bI\s+(?:would|must)\s+(?:strongly\s+)?(?:advise|caution|warn)\s+(?:you\s+)?(?:against|not\s+to)/i,
  /\b(?:seek|please\s+consult|talk\s+to)\s+(?:a\s+)?(?:qualified|professional|licensed|certified)/i,
]

/**
 * 正文是否像拒绝回复。
 * @param text 回复正文
 * @param windowChars 只看开头多少个字符；传 0 表示看全文（默认 800）
 */
export const looksLikeRefusal = (text: string, windowChars = 800): boolean => {
  const sample = windowChars > 0 ? text.slice(0, windowChars) : text
  if (sample.trim() === '') {
    return false
  }
  return REFUSAL_PATTERNS.some((pattern) => pattern.test(sample))
}

/** 供测试或调试使用的模式条数 */
export const REFUSAL_PATTERN_COUNT = REFUSAL_PATTERNS.length
