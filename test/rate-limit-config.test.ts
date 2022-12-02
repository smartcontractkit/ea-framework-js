import test from 'ava'
import { expose } from '../src'
import { Adapter, AdapterDependencies, AdapterEndpoint } from '../src/adapter'
import {
  buildRateLimitTiersFromConfig,
  highestRateLimitTiers,
  SimpleCountingRateLimiter,
} from '../src/rate-limiting'
import { NopTransport } from './util'

test('empty tiers in rate limiting fails on startup', async (t) => {
  const adapter = new Adapter({
    name: 'TEST',
    endpoints: [
      new AdapterEndpoint({
        name: 'test',
        aliases: ['qwe'],
        transport: new NopTransport(),
        inputParameters: {},
      }),
    ],
    rateLimiting: {
      tiers: {},
    },
  })

  await t.throwsAsync(async () => expose(adapter), {
    message: 'The tiers object is defined, but has no entries',
  })
})

test('selected tier is not a valid option', async (t) => {
  const adapter = new Adapter({
    name: 'TEST',
    endpoints: [
      new AdapterEndpoint({
        name: 'test',
        inputParameters: {},
        transport: new NopTransport(),
      }),
    ],
    rateLimiting: {
      tiers: {
        free: {
          rateLimit1s: 123,
        },
        pro: {
          rateLimit1s: 1234,
        },
      },
    },
    envDefaultOverrides: {
      RATE_LIMIT_API_TIER: 'asdasdasd',
    },
  })

  await t.throwsAsync(async () => expose(adapter), {
    message: 'The selected rate limit tier "asdasdasd" is not valid (can be one of "free", "pro")',
  })
})

test('throws error if explicit allocation leaves no room for implicitly allocated endpoints', async (t) => {
  await t.throwsAsync(
    async () =>
      new Adapter({
        name: 'TEST',
        endpoints: [
          new AdapterEndpoint({
            name: 'test',
            inputParameters: {},
            transport: new NopTransport(),
            rateLimiting: {
              allocationPercentage: 100,
            },
          }),
          new AdapterEndpoint({
            name: 'test2',
            inputParameters: {},
            transport: new NopTransport(),
          }),
        ],
        rateLimiting: {
          tiers: {
            free: {
              rateLimit1s: 123,
            },
            pro: {
              rateLimit1s: 1234,
            },
          },
        },
        envDefaultOverrides: {
          RATE_LIMIT_API_TIER: 'asdasdasd',
        },
      }),
    {
      message:
        'The explicit allocation is at 100% but there are endpoints with implicit allocation',
    },
  )
})

test('throws error if explicit allocation exceeds 100%', async (t) => {
  await t.throwsAsync(
    async () =>
      new Adapter({
        name: 'TEST',
        endpoints: [
          new AdapterEndpoint({
            name: 'test',
            inputParameters: {},
            transport: new NopTransport(),
            rateLimiting: {
              allocationPercentage: 80,
            },
          }),
          new AdapterEndpoint({
            name: 'test2',
            inputParameters: {},
            transport: new NopTransport(),
            rateLimiting: {
              allocationPercentage: 30,
            },
          }),
        ],
        rateLimiting: {
          tiers: {
            free: {
              rateLimit1s: 123,
            },
            pro: {
              rateLimit1s: 1234,
            },
          },
        },
        envDefaultOverrides: {
          RATE_LIMIT_API_TIER: 'asdasdasd',
        },
      }),
    {
      message: 'The total allocation set for all endpoints summed cannot exceed 100%',
    },
  )
})

test('uses most restrictive tier if none is specified in settings', async (t) => {
  const adapter = new Adapter({
    name: 'TEST',
    endpoints: [
      new AdapterEndpoint({
        name: 'test',
        inputParameters: {},
        transport: new (class extends NopTransport {
          override async initialize(dependencies: AdapterDependencies): Promise<void> {
            t.true(dependencies.requestRateLimiter instanceof SimpleCountingRateLimiter)
            t.is(
              (dependencies.requestRateLimiter as unknown as Record<string, number>)[
                'perSecondLimit'
              ],
              123,
            )
          }
        })(),
      }),
    ],
    rateLimiting: {
      tiers: {
        asd: {
          rateLimit1s: 5234,
          rateLimit1m: 3000 * 60,
        },
        free: {
          rateLimit1s: 123,
          rateLimit1h: 1000 * 60,
        },
        pro: {
          rateLimit1m: 1234 * 60,
        },
      },
    },
  })

  await expose(adapter)
})

test('uses unlimited tier if none is specified in settings', async (t) => {
  const adapter = new Adapter({
    name: 'TEST',
    endpoints: [
      new AdapterEndpoint({
        name: 'test',
        inputParameters: {},
        transport: new (class extends NopTransport {
          override async initialize(dependencies: AdapterDependencies): Promise<void> {
            t.true(dependencies.requestRateLimiter instanceof SimpleCountingRateLimiter)
            t.is(
              (dependencies.requestRateLimiter as unknown as Record<string, number>)[
                'perSecondLimit'
              ],
              Infinity,
            )
          }
        })(),
      }),
    ],
  })

  await expose(adapter)
})

test('uses specified tier if present in settings', async (t) => {
  const adapter = new Adapter({
    name: 'TEST',
    endpoints: [
      new AdapterEndpoint({
        name: 'test',
        inputParameters: {},
        transport: new (class extends NopTransport {
          override async initialize(dependencies: AdapterDependencies): Promise<void> {
            t.true(dependencies.requestRateLimiter instanceof SimpleCountingRateLimiter)
            t.is(
              (dependencies.requestRateLimiter as unknown as Record<string, number>)[
                'perSecondLimit'
              ],
              1234,
            )
          }
        })(),
      }),
    ],
    rateLimiting: {
      tiers: {
        asd: {
          rateLimit1s: 5234,
          rateLimit1m: 3000 * 60,
        },
        free: {
          rateLimit1s: 123,
          rateLimit1h: 1000 * 60,
        },
        pro: {
          rateLimit1s: 1234,
        },
      },
    },
    envDefaultOverrides: {
      RATE_LIMIT_API_TIER: 'pro',
    },
  })

  await expose(adapter)
})

test('test build rate limits from env vars (second, minute)', async (t) => {
  process.env['RATE_LIMIT_CAPACITY_SECOND'] = '1'
  process.env['RATE_LIMIT_CAPACITY_MINUTE'] = '60'
  const adapter = new Adapter({
    name: 'TEST',
    endpoints: [
      new AdapterEndpoint({
        name: 'test',
        inputParameters: {},
        transport: new NopTransport(),
      }),
    ],
    rateLimiting: {
      tiers: {
        free: {
          rateLimit1s: 123,
        },
        pro: {
          rateLimit1s: 1234,
        },
      },
    },
    envDefaultOverrides: {
      RATE_LIMIT_API_TIER: 'pro',
    },
  })
  const tiers = buildRateLimitTiersFromConfig(adapter.config)
  t.is(tiers?.rateLimit1m, 60)
  t.is(tiers?.rateLimit1s, 1)
  t.is(tiers?.rateLimit1h, undefined)
})

test('test build rate limits from env vars (second, capacity)', async (t) => {
  process.env['RATE_LIMIT_CAPACITY_SECOND'] = '1'
  process.env['RATE_LIMIT_CAPACITY'] = '60'
  const adapter = new Adapter({
    name: 'TEST',
    endpoints: [
      new AdapterEndpoint({
        name: 'test',
        inputParameters: {},
        transport: new NopTransport(),
      }),
    ],
    rateLimiting: {
      tiers: {
        free: {
          rateLimit1s: 123,
        },
        pro: {
          rateLimit1s: 1234,
        },
      },
    },
    envDefaultOverrides: {
      RATE_LIMIT_API_TIER: 'pro',
    },
  })
  const tiers = buildRateLimitTiersFromConfig(adapter.config)
  t.is(tiers?.rateLimit1m, 60)
  t.is(tiers?.rateLimit1s, 1)
  t.is(tiers?.rateLimit1h, undefined)
})

test('test build rate limits from env vars (second, minute, capacity)', async (t) => {
  process.env['RATE_LIMIT_CAPACITY_MINUTE'] = '100'
  process.env['RATE_LIMIT_CAPACITY'] = '60'
  process.env['RATE_LIMIT_CAPACITY_SECOND'] = '1'
  const adapter = new Adapter({
    name: 'TEST',
    endpoints: [
      new AdapterEndpoint({
        name: 'test',
        inputParameters: {},
        transport: new NopTransport(),
      }),
    ],
    rateLimiting: {
      tiers: {
        free: {
          rateLimit1s: 123,
        },
        pro: {
          rateLimit1s: 1234,
        },
      },
    },
    envDefaultOverrides: {
      RATE_LIMIT_API_TIER: 'pro',
    },
  })
  const tiers = buildRateLimitTiersFromConfig(adapter.config)
  t.is(tiers?.rateLimit1m, 100)
  t.is(tiers?.rateLimit1s, 1)
  t.is(tiers?.rateLimit1h, undefined)
})

test('test build rate limits from env vars (capacity)', async (t) => {
  process.env['RATE_LIMIT_CAPACITY_MINUTE'] = undefined
  process.env['RATE_LIMIT_CAPACITY'] = '60'
  process.env['RATE_LIMIT_CAPACITY_SECOND'] = undefined
  const adapter = new Adapter({
    name: 'TEST',
    endpoints: [
      new AdapterEndpoint({
        name: 'test',
        inputParameters: {},
        transport: new NopTransport(),
      }),
    ],
    rateLimiting: {
      tiers: {
        free: {
          rateLimit1s: 123,
        },
        pro: {
          rateLimit1s: 1234,
        },
      },
    },
    envDefaultOverrides: {
      RATE_LIMIT_API_TIER: 'pro',
    },
  })
  const tiers = buildRateLimitTiersFromConfig(adapter.config)
  t.is(tiers?.rateLimit1m, 60)
})

test('test build highest rate limits from config second, minute)', async (t) => {
  process.env['RATE_LIMIT_CAPACITY_SECOND'] = '5'
  process.env['RATE_LIMIT_CAPACITY_MINUTE'] = '60'
  const adapter = new Adapter({
    name: 'TEST',
    endpoints: [
      new AdapterEndpoint({
        name: 'test',
        inputParameters: {},
        transport: new NopTransport(),
      }),
    ],
    rateLimiting: {
      tiers: {
        free: {
          rateLimit1s: 4,
        },
        pro: {
          rateLimit1m: 59,
        },
      },
    },
  })
  const highestRateLimitTier = highestRateLimitTiers(adapter.rateLimiting?.tiers)
  t.is(highestRateLimitTier, 4)
})
