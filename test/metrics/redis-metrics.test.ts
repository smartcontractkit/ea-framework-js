import untypedTest, { TestFn } from 'ava'
import Redis from 'ioredis'
import { Adapter, AdapterDependencies, AdapterEndpoint, EndpointGenerics } from '../../src/adapter'
import { Cache, RedisCache } from '../../src/cache'
import { AdapterConfig } from '../../src/config'
import { BasicCacheSetterTransport, cacheTestInputParameters } from '../cache/helper'
import { NopTransport, RedisMock, TestAdapter } from '../../src/util/testing-utils'

export const test = untypedTest as TestFn<{
  testAdapter: TestAdapter
  cache: Cache
  adapterEndpoint: AdapterEndpoint<EndpointGenerics>
}>

test.before(async (t) => {
  process.env['METRICS_ENABLED'] = 'true'
  // Set unique port between metrics tests to avoid conflicts in metrics servers
  process.env['METRICS_PORT'] = '9091'
  const config = new AdapterConfig(
    {},
    {
      envDefaultOverrides: {
        CACHE_POLLING_SLEEP_MS: 10,
        CACHE_POLLING_MAX_RETRIES: 3,
      },
    },
  )
  const adapter = new Adapter({
    name: 'TEST',
    defaultEndpoint: 'test',
    config,
    endpoints: [
      new AdapterEndpoint({
        name: 'test',
        inputParameters: cacheTestInputParameters,
        transport: new BasicCacheSetterTransport(),
      }),
      new AdapterEndpoint({
        name: 'nowork',
        transport: new NopTransport(),
      }),
    ],
  })

  const cache = new RedisCache(new RedisMock() as unknown as Redis) // Fake redis
  const dependencies: Partial<AdapterDependencies> = {
    cache,
  }

  t.context.cache = cache
  t.context.testAdapter = await TestAdapter.start(adapter, t.context, dependencies)
})

test.serial('Test redis sent command metric', async (t) => {
  const data = {
    base: 'eth',
    factor: 123,
  }

  await t.context.testAdapter.request(data)

  const metrics = await t.context.testAdapter.getMetrics()
  metrics.assert(t, {
    name: 'redis_commands_sent_count',
    labels: {
      status: 'SUCCESS',
      function_name: 'exec',
    },
    expectedValue: 1,
  })
})
