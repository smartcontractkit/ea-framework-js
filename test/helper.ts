import FakeTimers from '@sinonjs/fake-timers'

export const installTimers = () => {
  return FakeTimers.install({
    toFake: [
      'setTimeout',
      'clearTimeout',
      'setImmediate',
      'clearImmediate',
      'setInterval',
      'clearInterval',
      'Date',
      'hrtime',
    ],
  })
}
