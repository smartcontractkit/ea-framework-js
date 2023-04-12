import test from 'ava'
import { start } from '../src'
import { Adapter, AdapterDependencies, AdapterEndpoint } from '../src/adapter'
import { AdapterConfig } from '../src/config'
import {
  buildRateLimitTiersFromConfig,
  BurstRateLimiter,
  highestRateLimitTiers,
} from '../src/rate-limiting'
import { NopTransport } from './util'
import { RateLimiterFactory, RateLimitingStrategy } from '../src/rate-limiting/factory'

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

  await t.throwsAsync(async () => start(adapter), {
    message: 'The tiers object is defined, but has no entries',
  })
})

test('selected tier is not a valid option', async (t) => {
  const config = new AdapterConfig(
    {},
    {
      envDefaultOverrides: {
        RATE_LIMIT_API_TIER: 'asdasdasd',
      },
    },
  )
  const adapter = new Adapter({
    name: 'TEST',
    config,
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
  })

  await t.throwsAsync(async () => start(adapter), {
    message: 'The selected rate limit tier "asdasdasd" is not valid (can be one of "free", "pro")',
  })
})

test('throws error if explicit allocation leaves no room for implicitly allocated endpoints', async (t) => {
  const config = new AdapterConfig(
    {},
    {
      envDefaultOverrides: {
        RATE_LIMIT_API_TIER: 'asdasdasd',
      },
    },
  )
  await t.throwsAsync(
    async () =>
      new Adapter({
        name: 'TEST',
        config,
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
      }),
    {
      message:
        'The explicit allocation is at 100% but there are endpoints with implicit allocation',
    },
  )
})

test('throws error if explicit allocation exceeds 100%', async (t) => {
  const config = new AdapterConfig(
    {},
    {
      envDefaultOverrides: {
        RATE_LIMIT_API_TIER: 'asdasdasd',
      },
    },
  )
  await t.throwsAsync(
    async () =>
      new Adapter({
        name: 'TEST',
        config,
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
            t.true(dependencies.rateLimiter instanceof BurstRateLimiter)
            t.is(
              (dependencies.rateLimiter as unknown as Record<string, number>)['perSecondLimit'],
              123,
            )
          }
        })(),
      }),
    ],
    config: new AdapterConfig(
      {},
      {
        envDefaultOverrides: {
          RATE_LIMITING_STRATEGY: 'burst',
        },
      },
    ),
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

  await start(adapter)
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
            t.true(dependencies.rateLimiter instanceof BurstRateLimiter)
            t.is(
              (dependencies.rateLimiter as unknown as Record<string, number>)['perSecondLimit'],
              Infinity,
            )
          }
        })(),
      }),
    ],
    config: new AdapterConfig(
      {},
      {
        envDefaultOverrides: {
          RATE_LIMITING_STRATEGY: 'burst',
        },
      },
    ),
  })

  await start(adapter)
})

test('uses specified tier if present in settings', async (t) => {
  const config = new AdapterConfig(
    {},
    {
      envDefaultOverrides: {
        RATE_LIMIT_API_TIER: 'pro',
        RATE_LIMITING_STRATEGY: 'burst',
      },
    },
  )
  const adapter = new Adapter({
    name: 'TEST',
    config,
    endpoints: [
      new AdapterEndpoint({
        name: 'test',
        inputParameters: {},
        transport: new (class extends NopTransport {
          override async initialize(dependencies: AdapterDependencies): Promise<void> {
            t.true(dependencies.rateLimiter instanceof BurstRateLimiter)
            t.is(
              (dependencies.rateLimiter as unknown as Record<string, number>)['perSecondLimit'],
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
  })

  await start(adapter)
})

test('test build rate limits from env vars (second, minute)', async (t) => {
  process.env['RATE_LIMIT_CAPACITY_SECOND'] = '1'
  process.env['RATE_LIMIT_CAPACITY_MINUTE'] = '60'
  const config = new AdapterConfig(
    {},
    {
      envDefaultOverrides: {
        RATE_LIMIT_API_TIER: 'pro',
        RATE_LIMITING_STRATEGY: 'burst',
      },
    },
  )
  const adapter = new Adapter({
    name: 'TEST',
    config,
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
  })
  const tiers = buildRateLimitTiersFromConfig(adapter.config.settings)
  t.is(tiers?.rateLimit1m, 60)
  t.is(tiers?.rateLimit1s, 1)
  t.is(tiers?.rateLimit1h, undefined)
})

test('test build rate limits from env vars (second, capacity)', async (t) => {
  process.env['RATE_LIMIT_CAPACITY_SECOND'] = '1'
  process.env['RATE_LIMIT_CAPACITY'] = '60'
  const config = new AdapterConfig(
    {},
    {
      envDefaultOverrides: {
        RATE_LIMIT_API_TIER: 'pro',
        RATE_LIMITING_STRATEGY: 'burst',
      },
    },
  )
  const adapter = new Adapter({
    name: 'TEST',
    config,
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
  })
  const tiers = buildRateLimitTiersFromConfig(adapter.config.settings)
  t.is(tiers?.rateLimit1m, 60)
  t.is(tiers?.rateLimit1s, 1)
  t.is(tiers?.rateLimit1h, undefined)
})

test('test build rate limits from env vars (second, minute, capacity)', async (t) => {
  process.env['RATE_LIMIT_CAPACITY_MINUTE'] = '100'
  process.env['RATE_LIMIT_CAPACITY'] = '60'
  process.env['RATE_LIMIT_CAPACITY_SECOND'] = '1'
  const config = new AdapterConfig(
    {},
    {
      envDefaultOverrides: {
        RATE_LIMIT_API_TIER: 'pro',
        RATE_LIMITING_STRATEGY: 'burst',
      },
    },
  )
  const adapter = new Adapter({
    name: 'TEST',
    config,
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
  })
  const tiers = buildRateLimitTiersFromConfig(adapter.config.settings)
  t.is(tiers?.rateLimit1m, 100)
  t.is(tiers?.rateLimit1s, 1)
  t.is(tiers?.rateLimit1h, undefined)
})

test('test build rate limits from env vars (capacity)', async (t) => {
  process.env['RATE_LIMIT_CAPACITY_MINUTE'] = undefined
  process.env['RATE_LIMIT_CAPACITY'] = '60'
  process.env['RATE_LIMIT_CAPACITY_SECOND'] = undefined
  const config = new AdapterConfig(
    {},
    {
      envDefaultOverrides: {
        RATE_LIMIT_API_TIER: 'pro',
        RATE_LIMITING_STRATEGY: 'burst',
      },
    },
  )
  const adapter = new Adapter({
    name: 'TEST',
    config,
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
  })
  const tiers = buildRateLimitTiersFromConfig(adapter.config.settings)
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

test('returns 0 when limit is set to infinity, no tier limit specified', async (t) => {
  const burstRateLimiter = RateLimiterFactory.buildRateLimiter(
    RateLimitingStrategy.BURST,
  ).initialize([], {})
  const time = burstRateLimiter.msUntilNextExecution()
  t.is(time, 0)
})

test('highestRateLimitTiers errors when no tiers are provided', async (t) => {
  await t.throwsAsync(async () => highestRateLimitTiers({}), {
    message: 'The tiers object is defined, but has no entries',
  })
})
