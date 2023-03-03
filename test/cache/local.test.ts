import { Adapter, AdapterDependencies, AdapterEndpoint } from '../../src/adapter'
import { CacheFactory, LocalCache } from '../../src/cache'
import { ProcessedConfig } from '../../src/config'
import { NopTransport, TestAdapter } from '../util'
import { BasicCacheSetterTransport, cacheTests, test } from './helper'

test.beforeEach(async (t) => {
  const processedConfig = new ProcessedConfig(
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
    processedConfig,
    endpoints: [
      new AdapterEndpoint({
        name: 'test',
        inputParameters: {
          base: {
            type: 'string',
            required: true,
          },
          factor: {
            type: 'number',
            required: true,
          },
        },
        transport: new BasicCacheSetterTransport(),
      }),
      new AdapterEndpoint({
        name: 'nowork',
        inputParameters: {},
        transport: new NopTransport(),
      }),
    ],
  })

  const cache = new LocalCache(adapter.processedConfig.settings.CACHE_MAX_ITEMS)
  const dependencies: Partial<AdapterDependencies> = {
    cache,
  }

  t.context.cache = cache
  t.context.testAdapter = await TestAdapter.start(adapter, t.context, dependencies)
})

cacheTests()

test.serial('Test cache factory success (redis)', async (t) => {
  try {
    CacheFactory.buildCache({ cacheType: 'local', maxSizeForLocalCache: 10000 })
    t.pass()
  } catch (e: unknown) {
    t.fail()
  }
})

test.serial('Test local cache max size', async (t) => {
  const cache = CacheFactory.buildCache({
    cacheType: 'local',
    maxSizeForLocalCache: 3,
  }) as LocalCache<number>
  await cache.set('1', 1, 10000)
  await cache.set('2', 2, 10000)
  await cache.set('3', 3, 10000)
  await cache.set('4', 4, 10000)

  const value1 = await cache.get('1')
  t.is(value1, undefined)
  const value2 = await cache.get('2')
  t.is(value2, 2)
  const value3 = await cache.get('3')
  t.is(value3, 3)
  const value4 = await cache.get('4')
  t.is(value4, 4)
})
