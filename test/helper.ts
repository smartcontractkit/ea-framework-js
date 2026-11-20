import FakeTimers from '@sinonjs/fake-timers'
import { createRequire } from 'node:module'

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

type CacheModule = { calculateCacheKey: typeof import('../src/cache').calculateCacheKey }

const loadCacheModule = createRequire(__filename) as (id: string) => CacheModule

/**
 * Wraps the shared `calculateCacheKey` so the number of key computations can be counted.
 * Call sites resolve it from the module object at call time, so the wrapper is honoured.
 */
export const countCacheKeyCalculations = async (fn: () => Promise<unknown>): Promise<number> => {
  const cacheModule = loadCacheModule('../src/cache')
  const original = cacheModule.calculateCacheKey
  let count = 0
  cacheModule.calculateCacheKey = (args) => {
    count += 1
    return original(args)
  }
  try {
    await fn()
  } finally {
    cacheModule.calculateCacheKey = original
  }
  return count
}
