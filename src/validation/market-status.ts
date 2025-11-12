import { AdapterInputError } from '../validation/error'
import { TZDate } from '@date-fns/tz'

export const parseWeekendString = (weekend?: string) => {
  const dayHour = /[0-6](0\d|1\d|2[0-3])/
  const timezonePattern = /[^\s]+/
  const regex = new RegExp(`^(${dayHour.source})-(${dayHour.source}):(${timezonePattern.source})$`)

  const match = weekend?.match(regex)
  if (!match) {
    throw new AdapterInputError({
      statusCode: 400,
      message: '[Param: weekend] does not match format of DHH-DHH:TZ',
    })
  }

  const result = {
    start: match[1],
    end: match[3],
    tz: match[5],
  }

  try {
    // eslint-disable-next-line new-cap
    Intl.DateTimeFormat(undefined, { timeZone: result.tz })
  } catch (error) {
    throw new AdapterInputError({
      statusCode: 400,
      message: `timezone ${result.tz} in [Param: weekend] is not valid: ${error}`,
    })
  }

  return result
}

export const isWeekendNow = (weekend?: string) => {
  const parsed = parseWeekendString(weekend)

  const startDay = Number(parsed.start[0])
  const startHour = Number(parsed.start.slice(1))
  const endDay = Number(parsed.end[0])
  const endHour = Number(parsed.end.slice(1))

  const nowDay = TZDate.tz(parsed.tz).getDay()
  const nowHour = TZDate.tz(parsed.tz).getHours()

  // Case 1: weekend does NOT wrap around the week
  if (startDay < endDay || (startDay === endDay && startHour < endHour)) {
    if (nowDay < startDay || nowDay > endDay) {
      return false
    } else if (nowDay === startDay && nowHour < startHour) {
      return false
    } else if (nowDay === endDay && nowHour >= endHour) {
      return false
    }
    return true
  }

  // Case 2: weekend wraps around (e.g. Fri → Sun)
  if (nowDay > startDay || nowDay < endDay) {
    return true
  } else if (nowDay === startDay && nowHour >= startHour) {
    return true
  } else if (nowDay === endDay && nowHour < endHour) {
    return true
  }
  return false
}
