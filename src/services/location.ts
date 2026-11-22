export const regionCodes: string[] =
  'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'.split(' ')

/** 科幻/特殊位置：空间站、月球、火星，覆盖普通行政区选择 */
export const specialPlaces = [
  { id: 'station-satellite', zh: '空间站 · 卫星', en: 'Space Station · Satellite' },
  { id: 'station-core', zh: '空间站 · 空间站', en: 'Space Station · Station' },
  { id: 'moon-near', zh: '月球 · 月之明面', en: 'Moon · Near Side' },
  { id: 'moon-far', zh: '月球 · 月之暗面', en: 'Moon · Far Side' },
  { id: 'mars-center', zh: '火星 · 时空管理中心', en: 'Mars · Spacetime Management Center' },
] as const

export type SpecialPlace = (typeof specialPlaces)[number]['id']

const specialPlaceIds = new Set<string>(specialPlaces.map((item) => item.id))

export const specialPlaceName = (id: SpecialPlace): string =>
  specialPlaces.find((item) => item.id === id)?.en ?? id

export type UserLocation = {
  region: string
  province?: string
  city?: string
  /** 设置后忽略行政区，作为位置注入 latest_reminder */
  place?: SpecialPlace
  /** 用户手动输入的位置，优先于行政区与特殊位置；只影响 latest_reminder */
  custom?: string
}

/** 自定义位置只作为一行文本注入，去掉换行、逗号并限制长度，避免破坏 latest_reminder 字段 */
const normalizeCustomPlace = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined
  }
  const text = value
    .replace(/[\r\n,]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text === '' ? undefined : text.slice(0, 120)
}

const regions = new Set(regionCodes)
const regionNames = new Intl.DisplayNames(['en-US'], { type: 'region' })

export const getRegionName = (code: string): string =>
  regions.has(code) ? regionNames.of(code) ?? code : ''

export const normalizeLocation = (value: unknown): UserLocation | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  const location = value as Record<string, unknown>
  const { region, place } = location
  const custom = normalizeCustomPlace(location.custom)
  if (custom) {
    return { region: 'CN', custom }
  }
  if (place !== undefined) {
    return typeof place === 'string' && specialPlaceIds.has(place)
      ? { region: 'CN', place: place as SpecialPlace }
      : null
  }
  if (typeof region !== 'string' || !regions.has(region)) {
    return null
  }
  return { region }
}
