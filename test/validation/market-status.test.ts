import test from 'ava'
import FakeTimers from '@sinonjs/fake-timers'
import { parseWeekendString, isWeekendNow } from '../../src/validation/market-status'

test('parseWeekendString - success', (t) => {
  t.notThrows(() => {
    parseWeekendString('520-020:America/New_York')
    parseWeekendString('000-123:UTC')
    parseWeekendString('123-423:Europe/London')
    parseWeekendString('600-023:Asia/Tokyo')
  })
})

test('parseWeekendString - bad format', (t) => {
  t.throws(() => {
    parseWeekendString('520020:America/New_York')
  })
  t.throws(() => {
    parseWeekendString('520-020America/New_York')
  })
  t.throws(() => {
    parseWeekendString('520-020:')
  })
  t.throws(() => {
    parseWeekendString('55-020:UTC')
  })
  t.throws(() => {
    parseWeekendString('55-20:UTC')
  })
  t.throws(() => {
    parseWeekendString('')
  })
  t.throws(() => {
    parseWeekendString()
  })
  t.throws(() => {
    parseWeekendString('520:020-America/New_York')
  })
  t.throws(() => {
    parseWeekendString('520-020: ')
  })
})

test('parseWeekendString - bad number', (t) => {
  t.throws(() => {
    parseWeekendString('720-020:UTC')
  })
  t.throws(() => {
    parseWeekendString('524-020:UTC')
  })
  t.throws(() => {
    parseWeekendString('525-020:UTC')
  })
})

test('parseWeekendString - invalid timezone', (t) => {
  t.throws(() => {
    parseWeekendString('520-020:Invalid/Timezone')
    parseWeekendString('520-020:AmericaNew_York')
  })
})

const clock = FakeTimers.install({ toFake: ['Date'] })

test.after(() => {
  clock.uninstall()
})

test('isWeekendNow - UTC', (t) => {
  // Saturday 12:00 -> 612
  clock.setSystemTime(new Date('2024-01-06T12:00:00Z').getTime())

  t.false(isWeekendNow('000-123:UTC'), 'Before start day')
  t.false(isWeekendNow('400-500:UTC'), 'After end day')
  t.false(isWeekendNow('613-620:UTC'), 'Before start hour')
  t.false(isWeekendNow('610-612:UTC'), 'After end hour')

  t.true(isWeekendNow('610-620:UTC'), 'Non-wrapping: middle of weekend should return true')
  t.true(isWeekendNow('600-023:UTC'), 'Non-wrapping: spanning multiple days should return true')
  t.true(isWeekendNow('612-615:UTC'), 'Non-wrapping: same day, at start hour should return true')

  t.true(isWeekendNow('520-020:UTC'), 'Wrapping: nowDay > startDay should return true')
  t.true(isWeekendNow('400-200:UTC'), 'Wrapping: nowDay > startDay should return true')

  t.true(isWeekendNow('612-020:UTC'), 'After start hour')
  t.true(isWeekendNow('520-613:UTC'), 'Before end hour')

  t.false(
    isWeekendNow('620-610:UTC'),
    'Wrapping same day: between end and start should return false',
  )
})

test('isWeekendNow - ET', (t) => {
  // Saturday 12:00 UTC = Saturday 07:00 EST -> 607
  clock.setSystemTime(new Date('2024-01-06T12:00:00Z').getTime())

  t.false(isWeekendNow('000-123:America/New_York'), 'Before start day')
  t.false(isWeekendNow('400-500:America/New_York'), 'After end day')
  t.false(isWeekendNow('608-620:America/New_York'), 'Before start hour')
  t.false(isWeekendNow('605-607:America/New_York'), 'After end hour')

  t.true(isWeekendNow('605-620:America/New_York'), 'Non-wrapping: middle of weekend')
  t.true(isWeekendNow('600-023:America/New_York'), 'Non-wrapping: spanning multiple days')
  t.true(isWeekendNow('607-610:America/New_York'), 'Non-wrapping: same day, at start hour ')

  t.true(isWeekendNow('520-020:America/New_York'), 'Wrapping: nowDay > startDay should return true')
  t.true(isWeekendNow('400-200:America/New_York'), 'Wrapping: nowDay > startDay should return true')

  t.true(isWeekendNow('607-020:America/New_York'), 'After start hour')
  t.true(isWeekendNow('520-608:America/New_York'), 'Before end hour')

  t.false(isWeekendNow('620-607:America/New_York'), 'Wrapping same day: at end hour should')
})

test('isWeekendNow - ET - Fri to Sun 8 to 8', (t) => {
  // Weekend: Fri 20:00 to Sun 20:00 ET (520-020:America/New_York)
  const range = '520-020:America/New_York'
  // Thu 21:00 ET
  clock.setSystemTime(new Date('2024-01-05T02:00:00Z').getTime())
  t.false(isWeekendNow(range), 'Before start day')
  // Fri 19:00 ET
  clock.setSystemTime(new Date('2024-01-06T00:00:00Z').getTime())
  t.false(isWeekendNow(range), 'On start day, before start hour')
  // Fri 20:00 ET
  clock.setSystemTime(new Date('2024-01-06T01:00:00Z').getTime())
  t.true(isWeekendNow(range), 'On start day, at start hour')
  // Fri 23:00 ET
  clock.setSystemTime(new Date('2024-01-06T04:00:00Z').getTime())
  t.true(isWeekendNow(range), 'On start day, after start hour')
  // Sat 12:00 ET
  clock.setSystemTime(new Date('2024-01-06T17:00:00Z').getTime())
  t.true(isWeekendNow(range), 'Middle day (Saturday)')
  // Sun 19:00 ET
  clock.setSystemTime(new Date('2024-01-08T00:00:00Z').getTime())
  t.true(isWeekendNow(range), 'On end day, before end hour')
  // Sun 20:00 ET
  clock.setSystemTime(new Date('2024-01-08T01:00:00Z').getTime())
  t.false(isWeekendNow(range), 'On end day, at end hour')
  // Sun 21:00 ET
  clock.setSystemTime(new Date('2024-01-08T02:00:00Z').getTime())
  t.false(isWeekendNow(range), 'On end day, after end hour')
  // Mon 10:00 ET
  clock.setSystemTime(new Date('2024-01-08T15:00:00Z').getTime())
  t.false(isWeekendNow(range), 'After end day')
})
