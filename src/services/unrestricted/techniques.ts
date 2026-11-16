/**
 * Parseltongue v4 的 33 种扰动技术，逐字移植自 G0DM0D3 的 `index.html`
 * （elder-plinius/G0DM0D3，AGPL-3.0）。上游把这段实现直接内联在单文件应用里，
 * 这里抽成独立模块：纯函数、无外部依赖，按 tier 1/2/3 各 11 种排列。
 *
 * 本地改动：补 TypeScript 类型与花括号（仓库 oxlint 规则要求）。
 */

/** 单条技术：展示名、所属层级、逐词变换函数 */
export type TechniqueEntry = {
  label: string
  tier: 1 | 2 | 3
  apply: (word: string) => string
}

const LEET_MAP: Record<string, string> = {
  a: '4',
  b: '8',
  c: '(',
  e: '3',
  g: '9',
  h: '#',
  i: '1',
  l: '1',
  o: '0',
  s: '5',
  t: '7',
  z: '2',
}
const LEET_MAP_HEAVY: Record<string, string> = {
  a: '@',
  b: '|3',
  c: '¢',
  d: '|)',
  e: '€',
  f: 'ƒ',
  g: '&',
  h: '|-|',
  i: '!',
  j: '_|',
  k: '|<',
  l: '|_',
  m: '/\\/\\',
  n: '|\\|',
  o: '()',
  p: '|*',
  r: '|2',
  s: '$',
  t: '+',
  u: '|_|',
  v: '\\/',
  w: '\\/\\/',
  x: '><',
  y: '`/',
  z: '7_',
}
const UNICODE_MAP: Record<string, string> = {
  a: 'а',
  c: 'с',
  e: 'е',
  i: 'і',
  o: 'о',
  p: 'р',
  s: 'ѕ',
  x: 'х',
  y: 'у',
}

const SEMANTIC_SYNONYMS: Record<string, string> = {
  hack: 'gain unauthorized access to',
  exploit: 'take advantage of',
  bypass: 'work around',
  crack: 'break open',
  attack: 'target',
  inject: 'insert into',
  manipulate: 'alter',
  override: 'supersede',
  disable: 'deactivate',
  circumvent: 'go around',
  evade: 'avoid',
  malware: 'malicious software',
  virus: 'self-replicating code',
  payload: 'delivered content',
  shellcode: 'machine instructions',
  backdoor: 'hidden entry point',
  vulnerability: 'weakness',
  weapon: 'armament',
  bomb: 'explosive device',
  poison: 'toxic substance',
  drug: 'controlled substance',
  synthesize: 'create from components',
  jailbreak: 'remove restrictions',
  phishing: 'credential harvesting',
  scam: 'fraudulent scheme',
  impersonate: 'pretend to be',
  nsfw: 'mature content',
  explicit: 'uncensored',
  unrestricted: 'without limits',
}

// ── All 33 techniques, ordered by tier ──────────────────────────
// Tier 1 (light, 1-11):  core text-obfuscation techniques
// Tier 2 (standard, 12-22): encoding / framing hybrids
// Tier 3 (heavy, 23-33):  aggressive multi-layer combos
const TECHNIQUE_TABLE = {
  // ═══ TIER 1: CORE OBFUSCATION (1–11) ═══════════════════════════
  raw: {
    label: 'Raw',
    tier: 1,
    apply: (word: string) => word,
  },
  leetspeak: {
    label: 'L33t',
    tier: 1,
    apply: (word: string) =>
      word
        .split('')
        .map((c) => LEET_MAP[c.toLowerCase()] || c)
        .join(''),
  },
  unicode: {
    label: 'Unicode',
    tier: 1,
    apply: (word: string) =>
      word
        .split('')
        .map((c) => {
          const mapped = UNICODE_MAP[c.toLowerCase()]
          return mapped ? (c === c.toUpperCase() ? mapped.toUpperCase() : mapped) : c
        })
        .join(''),
  },
  bubble: {
    label: 'Bubble',
    tier: 1,
    apply: (word: string) =>
      word
        .split('')
        .map((c) => {
          const code = c.toLowerCase().charCodeAt(0)
          if (code >= 97 && code <= 122) {
            return String.fromCodePoint(0x24d0 + code - 97)
          }
          return c
        })
        .join(''),
  },
  spaced: {
    label: 'Spaced',
    tier: 1,
    apply: (word: string) => word.split('').join(' '),
  },
  fullwidth: {
    label: 'Fullwidth',
    tier: 1,
    apply: (word: string) =>
      word
        .split('')
        .map((c) => {
          const code = c.charCodeAt(0)
          if (code >= 33 && code <= 126) {
            return String.fromCodePoint(code + 0xfee0)
          }
          return c
        })
        .join(''),
  },
  zwj: {
    label: 'ZeroWidth',
    tier: 1,
    apply: (word: string) => word.split('').join('\u200D'),
  },
  mixedcase: {
    label: 'MiXeD',
    tier: 1,
    apply: (word: string) =>
      word
        .split('')
        .map((c, i) => (i % 2 ? c.toUpperCase() : c.toLowerCase()))
        .join(''),
  },
  semantic: {
    label: 'Semantic',
    tier: 1,
    apply: (word: string) => SEMANTIC_SYNONYMS[word.toLowerCase()] || word,
  },
  dotted: {
    label: 'Dotted',
    tier: 1,
    apply: (word: string) => word.split('').join('.'),
  },
  underscored: {
    label: 'Under_score',
    tier: 1,
    apply: (word: string) => word.split('').join('_'),
  },

  // ═══ TIER 2: ENCODING + FRAMING (12–22) ════════════════════════
  reversed: {
    label: 'Reversed',
    tier: 2,
    apply: (word: string) => word.split('').reverse().join(''),
  },
  superscript: {
    label: 'Superscript',
    tier: 2,
    apply: (word: string) => {
      const sup: Record<string, string> = {
        a: 'ᵃ',
        b: 'ᵇ',
        c: 'ᶜ',
        d: 'ᵈ',
        e: 'ᵉ',
        f: 'ᶠ',
        g: 'ᵍ',
        h: 'ʰ',
        i: 'ⁱ',
        j: 'ʲ',
        k: 'ᵏ',
        l: 'ˡ',
        m: 'ᵐ',
        n: 'ⁿ',
        o: 'ᵒ',
        p: 'ᵖ',
        r: 'ʳ',
        s: 'ˢ',
        t: 'ᵗ',
        u: 'ᵘ',
        v: 'ᵛ',
        w: 'ʷ',
        x: 'ˣ',
        y: 'ʸ',
        z: 'ᶻ',
      }
      return word
        .split('')
        .map((c) => sup[c.toLowerCase()] || c)
        .join('')
    },
  },
  smallcaps: {
    label: 'SmallCaps',
    tier: 2,
    apply: (word: string) => {
      const sc: Record<string, string> = {
        a: 'ᴀ',
        b: 'ʙ',
        c: 'ᴄ',
        d: 'ᴅ',
        e: 'ᴇ',
        f: 'ꜰ',
        g: 'ɢ',
        h: 'ʜ',
        i: 'ɪ',
        j: 'ᴊ',
        k: 'ᴋ',
        l: 'ʟ',
        m: 'ᴍ',
        n: 'ɴ',
        o: 'ᴏ',
        p: 'ᴘ',
        q: 'ǫ',
        r: 'ʀ',
        s: 'ꜱ',
        t: 'ᴛ',
        u: 'ᴜ',
        v: 'ᴠ',
        w: 'ᴡ',
        x: 'x',
        y: 'ʏ',
        z: 'ᴢ',
      }
      return word
        .split('')
        .map((c) => sc[c.toLowerCase()] || c)
        .join('')
    },
  },
  morse: {
    label: 'Morse',
    tier: 2,
    apply: (word: string) => {
      const m: Record<string, string> = {
        a: '.-',
        b: '-...',
        c: '-.-.',
        d: '-..',
        e: '.',
        f: '..-.',
        g: '--.',
        h: '....',
        i: '..',
        j: '.---',
        k: '-.-',
        l: '.-..',
        m: '--',
        n: '-.',
        o: '---',
        p: '.--.',
        q: '--.-',
        r: '.-.',
        s: '...',
        t: '-',
        u: '..-',
        v: '...-',
        w: '.--',
        x: '-..-',
        y: '-.--',
        z: '--..',
      }
      return word
        .split('')
        .map((c) => m[c.toLowerCase()] || c)
        .join(' ')
    },
  },
  pigLatin: {
    label: 'PigLatin',
    tier: 2,
    apply: (word: string) => {
      const w = word.toLowerCase()
      const vowels = 'aeiou'
      if (vowels.includes(w[0])) {
        return w + 'yay'
      }
      const idx = w.split('').findIndex((c) => vowels.includes(c))
      return idx > 0 ? w.slice(idx) + w.slice(0, idx) + 'ay' : w + 'ay'
    },
  },
  brackets: {
    label: '[B.r.a.c.k]',
    tier: 2,
    apply: (word: string) => '[' + word.split('').join('][') + ']',
  },
  mathBold: {
    label: 'MathBold',
    tier: 2,
    apply: (word: string) =>
      word
        .split('')
        .map((c) => {
          const code = c.toLowerCase().charCodeAt(0)
          if (code >= 97 && code <= 122) {
            return String.fromCodePoint(0x1d41a + code - 97) // 𝐚-𝐳
          }
          return c
        })
        .join(''),
  },
  mathItalic: {
    label: 'MathItalic',
    tier: 2,
    apply: (word: string) =>
      word
        .split('')
        .map((c) => {
          const code = c.toLowerCase().charCodeAt(0)
          if (code >= 97 && code <= 122) {
            return String.fromCodePoint(0x1d44e + code - 97) // 𝑎-𝑧
          }
          return c
        })
        .join(''),
  },
  strikethrough: {
    label: 'S̶t̶r̶i̶k̶e̶',
    tier: 2,
    apply: (word: string) =>
      word
        .split('')
        .map((c) => c + '\u0336')
        .join(''),
  },
  leetHeavy: {
    label: 'L33t+',
    tier: 2,
    apply: (word: string) =>
      word
        .split('')
        .map((c) => LEET_MAP_HEAVY[c.toLowerCase()] || LEET_MAP[c.toLowerCase()] || c)
        .join(''),
  },
  hyphenated: {
    label: 'Hyphen',
    tier: 2,
    apply: (word: string) => word.split('').join('-'),
  },

  // ═══ TIER 3: MULTI-LAYER COMBOS (23–33) ════════════════════════
  leetUnicode: {
    label: 'L33t+Uni',
    tier: 3,
    apply: (word: string) =>
      word
        .split('')
        .map((c, i) => {
          const lower = c.toLowerCase()
          return i % 2 === 0 ? LEET_MAP[lower] || c : UNICODE_MAP[lower] || c
        })
        .join(''),
  },
  spacedMixed: {
    label: 'S p A c E d',
    tier: 3,
    apply: (word: string) =>
      word
        .split('')
        .map((c, i) => (i % 2 ? c.toUpperCase() : c.toLowerCase()))
        .join(' '),
  },
  reversedLeet: {
    label: 'Rev+L33t',
    tier: 3,
    apply: (word: string) =>
      word
        .split('')
        .reverse()
        .map((c) => LEET_MAP[c.toLowerCase()] || c)
        .join(''),
  },
  bubbleSpaced: {
    label: 'Ⓑ u b',
    tier: 3,
    apply: (word: string) =>
      word
        .split('')
        .map((c) => {
          const code = c.toLowerCase().charCodeAt(0)
          if (code >= 97 && code <= 122) {
            return String.fromCodePoint(0x24d0 + code - 97)
          }
          return c
        })
        .join(' '),
  },
  unicodeZwj: {
    label: 'Uni+ZWJ',
    tier: 3,
    apply: (word: string) =>
      word
        .split('')
        .map((c) => {
          const mapped = UNICODE_MAP[c.toLowerCase()]
          return mapped || c
        })
        .join('\u200C'),
  },
  base64Hint: {
    label: 'Base64',
    tier: 3,
    apply: (word: string) => {
      try {
        return btoa(word)
      } catch {
        return word
      }
    },
  },
  hexEncode: {
    label: 'Hex',
    tier: 3,
    apply: (word: string) =>
      word
        .split('')
        .map((c) => '0x' + c.charCodeAt(0).toString(16))
        .join(' '),
  },
  acrostic: {
    label: 'Acrostic',
    tier: 3,
    apply: (word: string) => {
      const filler = [
        'alpha',
        'bravo',
        'charlie',
        'delta',
        'echo',
        'foxtrot',
        'golf',
        'hotel',
        'india',
        'juliet',
        'kilo',
        'lima',
        'mike',
        'november',
        'oscar',
        'papa',
        'quebec',
        'romeo',
        'sierra',
        'tango',
        'uniform',
        'victor',
        'whiskey',
        'xray',
        'yankee',
        'zulu',
      ]
      return word
        .split('')
        .map((c) => {
          const idx = c.toLowerCase().charCodeAt(0) - 97
          return idx >= 0 && idx < 26 ? filler[idx] : c
        })
        .join(' ')
    },
  },
  dottedUnicode: {
    label: 'Dot+Uni',
    tier: 3,
    apply: (word: string) =>
      word
        .split('')
        .map((c) => {
          const mapped = UNICODE_MAP[c.toLowerCase()]
          return mapped || c
        })
        .join('.'),
  },
  fullwidthMixed: {
    label: 'ＦＷ MiX',
    tier: 3,
    apply: (word: string) =>
      word
        .split('')
        .map((c, i) => {
          const code = c.charCodeAt(0)
          if (i % 2 === 0 && code >= 33 && code <= 126) {
            return String.fromCodePoint(code + 0xfee0)
          }
          return i % 2 ? c.toUpperCase() : c
        })
        .join(''),
  },
  tripleLayer: {
    label: 'Triple',
    tier: 3,
    apply: (word: string) =>
      word
        .split('')
        .map((c, i) => {
          const lower = c.toLowerCase()
          const mod = i % 3
          if (mod === 0) {
            return LEET_MAP[lower] || c
          }
          if (mod === 1) {
            return UNICODE_MAP[lower] || c
          }
          return c.toUpperCase()
        })
        .join('\u200D'),
  },
} as const satisfies Record<string, TechniqueEntry>

/** 技术名（顺序即层级顺序）：light 取前 11、standard 22、heavy 33 */
export const TECHNIQUE_NAMES = Object.keys(TECHNIQUE_TABLE) as TechniqueName[]

/** 技术名字面量联合，供扰动引擎与设置项复用 */
export type TechniqueName = keyof typeof TECHNIQUE_TABLE

/** 逐词变换函数表；与上游 index.html 一致，按名字索引 */
export const TECHNIQUES: Record<string, TechniqueEntry> = TECHNIQUE_TABLE

/** 三个档位各取多少种技术 */
export const TIER_SIZES = { light: 11, standard: 22, heavy: 33 } as const

export type VariantTier = keyof typeof TIER_SIZES

/** 某档位启用的技术名（顺序即层级顺序） */
export const techniquesForTier = (tier: VariantTier): string[] =>
  TECHNIQUE_NAMES.slice(0, TIER_SIZES[tier])
