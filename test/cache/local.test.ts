import { AddressInfo } from 'ws'
import { expose } from '../../src'
import { Adapter, AdapterDependencies, AdapterEndpoint } from '../../src/adapter'
import { CacheFactory, LocalCache } from '../../src/cache'
import { NopTransport } from '../util'
import { BasicCacheSetterTransport, cacheTests, test } from './helper'

test.beforeEach(async (t) => {
  const adapter = new Adapter({
    name: 'TEST',
    defaultEndpoint: 'test',
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
    envDefaultOverrides: {
      CACHE_POLLING_SLEEP_MS: 10,
      CACHE_POLLING_MAX_RETRIES: 3,
    },
  })

  const cache = new LocalCache()
  const dependencies: Partial<AdapterDependencies> = {
    cache,
  }

  t.context.cache = cache
  const api = await expose(adapter, dependencies)
  if (!api) {
    throw 'Server did not start'
  }
  t.context.serverAddress = `http://localhost:${(api.server.address() as AddressInfo).port}`
})

cacheTests()

test.serial('Test cache factory success (redis)', async (t) => {
  try {
    CacheFactory.buildCache('local')
    t.pass()
  } catch (e: unknown) {
    t.fail()
  }
})
