import { getRegionName, specialPlaceName, type UserLocation } from '../location.js'
import { formatDate } from '../../utils/format.js'
import { translate } from '../../i18n/index.js'

const locationName = (location: UserLocation | null): string => {
  if (!location) {
    return ''
  }
  if (location.custom) {
    return location.custom
  }
  if (location.place) {
    return specialPlaceName(location.place)
  }
  return getRegionName(location.region)
}

/** 模型约定的五项信息；日期与星期使用浏览器本地时区，避免 UTC 日期跨日。 */
export const createLatestReminder = (
  { location }: { location: UserLocation | null },
  now = new Date()
): string => {
  return [
    formatDate(now),
    new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(now),
    locationName(location),
    'Web',
    translate('latestReminderLanguage'),
  ].join(',')
}
