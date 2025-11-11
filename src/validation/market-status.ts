import { AdapterInputError } from '../validation/error'
import { TZDate } from '@date-fns/tz'

export const validateWeekend = (weekend?: string) => {
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

  try {
    // eslint-disable-next-line new-cap
    Intl.DateTimeFormat(undefined, { timeZone: weekend?.split(':')[1] })
  } catch (error) {
    throw new AdapterInputError({
      statusCode: 400,
      message: `[Param: weekend] is not valid: ${error}`,
    })
  }
}

export const isWeekend = (weekend?: string) => {
  validateWeekend(weekend)

  // Weekend looks like 520-020:America/New_York
  const [range, tz] = (weekend || '').split(':')
  const [start, end] = range.split('-')

  const startDay = Number(start[0])
  const startHour = Number(start.slice(1))
  const endDay = Number(end[0])
  const endHour = Number(end.slice(1))

  const nowDay = TZDate.tz(tz).getDay()
  const nowHour = TZDate.tz(tz).getHours()

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
