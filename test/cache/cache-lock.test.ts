import Redis from 'ioredis'
import { ExecutionError } from 'redlock'
import { Adapter, AdapterDependencies, AdapterEndpoint } from '../../src/adapter'
import { RedisCache } from '../../src/cache'
import { AdapterConfig } from '../../src/config'
import { sleep } from '../../src/util'
import { MockCache, NopTransport, RedisMock, TestAdapter } from '../../src/util/testing-utils'
import { test } from './helper'

test.serial(
  'An adapter with a duplicate name and no cache prefix should fail to acquire a lock',
  async (t) => {
    const config = new AdapterConfig(
      {},
      {
        envDefaultOverrides: {
          CACHE_TYPE: 'redis',
          CACHE_REDIS_PORT: 6000,
          CACHE_LOCK_DURATION: 2000,
          CACHE_LOCK_RETRIES: 2,
        },
      },
    )
    const adapter = new Adapter({
      name: 'TEST',
      defaultEndpoint: 'test',
      config,
      endpoints: [
        new AdapterEndpoint({
          name: 'nowork',
          transport: new NopTransport(),
        }),
      ],
    })

    const config2 = new AdapterConfig(
      {},
      {
        envDefaultOverrides: {
          CACHE_TYPE: 'redis',
          CACHE_REDIS_PORT: 6000,
          CACHE_LOCK_DURATION: 2000,
          CACHE_LOCK_RETRIES: 2,
        },
      },
    )
    const adapter2 = new Adapter({
      name: 'TEST',
      defaultEndpoint: 'test',
      config: config2,
      endpoints: [
        new AdapterEndpoint({
          name: 'nowork',
          transport: new NopTransport(),
        }),
      ],
    })

    const redisClient = new RedisMock() as unknown as Redis
    const cache = new RedisCache(redisClient) // Fake redis
    const dependencies: Partial<AdapterDependencies> = {
      cache,
      redisClient,
    }

    try {
      await TestAdapter.start(adapter, t.context, dependencies)
      await TestAdapter.start(adapter2, t.context, dependencies)

      t.fail('An ExecutionError should have been thrown')
    } catch (error) {
      if (error instanceof ExecutionError) {
        t.is(error.message, 'The operation was unable to achieve a quorum during its retry window.')
      } else {
        t.fail('An ExecutionError should have been thrown')
      }
    }
  },
)

test.serial(
  'An adapter with a duplicate name but a unique cache prefix should acquire successfully acquire a lock',
  async (t) => {
    const config = new AdapterConfig(
      {},
      {
        envDefaultOverrides: {
          CACHE_TYPE: 'redis',
          CACHE_REDIS_PORT: 6000,
        },
      },
    )
    const adapter = new Adapter({
      name: 'TEST',
      defaultEndpoint: 'test',
      config,
      endpoints: [
        new AdapterEndpoint({
          name: 'nowork',
          transport: new NopTransport(),
        }),
      ],
    })

    const config2 = new AdapterConfig(
      {},
      {
        envDefaultOverrides: {
          CACHE_TYPE: 'redis',
          CACHE_REDIS_PORT: 6000,
          CACHE_PREFIX: 'PREFIX',
        },
      },
    )
    const adapter2 = new Adapter({
      name: 'TEST',
      defaultEndpoint: 'test',
      config: config2,
      endpoints: [
        new AdapterEndpoint({
          name: 'nowork',
          transport: new NopTransport(),
        }),
      ],
    })

    const redisClient = new RedisMock() as unknown as Redis
    const cache = new RedisCache(redisClient) // Fake redis
    const dependencies: Partial<AdapterDependencies> = {
      cache,
      redisClient,
    }

    try {
      await TestAdapter.start(adapter, t.context, dependencies)
      await TestAdapter.start(adapter2, t.context, dependencies)

      t.pass()
    } catch (error) {
      t.fail(`The following error should not have been thrown: ${error}`)
    }
  },
)

test.serial(
  'An adapter with a duplicate name but using a local cache should not attempt to acquire a lock',
  async (t) => {
    const config = new AdapterConfig(
      {},
      {
        envDefaultOverrides: {
          CACHE_TYPE: 'redis',
          CACHE_REDIS_PORT: 6000,
        },
      },
    )
    const adapter = new Adapter({
      name: 'TEST',
      defaultEndpoint: 'test',
      config,
      endpoints: [
        new AdapterEndpoint({
          name: 'nowork',
          transport: new NopTransport(),
        }),
      ],
    })

    const config2 = new AdapterConfig(
      {},
      {
        envDefaultOverrides: {
          CACHE_TYPE: 'local',
        },
      },
    )
    const adapter2 = new Adapter({
      name: 'TEST',
      defaultEndpoint: 'test',
      config: config2,
      endpoints: [
        new AdapterEndpoint({
          name: 'nowork',
          transport: new NopTransport(),
        }),
      ],
    })

    const redisClient = new RedisMock() as unknown as Redis
    let cache: RedisCache | MockCache = new RedisCache(redisClient) // Fake redis

    const dependencies: Partial<AdapterDependencies> = {
      cache,
      redisClient,
    }

    cache = new MockCache(100) // Fake local cache

    const dependencies2: Partial<AdapterDependencies> = {
      cache,
    }

    try {
      await TestAdapter.start(adapter, t.context, dependencies)
      await TestAdapter.start(adapter2, t.context, dependencies2)

      t.pass()
    } catch (error) {
      t.fail(`The following error should not have been thrown: ${error}`)
    }
  },
)

test.serial(
  'A lock should automatically extend and prevent another adapter from acquiring a lock with the same key',
  async (t) => {
    const config = new AdapterConfig(
      {},
      {
        envDefaultOverrides: {
          CACHE_TYPE: 'redis',
          CACHE_REDIS_PORT: 6000,
          CACHE_LOCK_DURATION: 1000,
        },
      },
    )
    const adapter = new Adapter({
      name: 'TEST',
      defaultEndpoint: 'test',
      config,
      endpoints: [
        new AdapterEndpoint({
          name: 'nowork',
          transport: new NopTransport(),
        }),
      ],
    })

    const config2 = new AdapterConfig(
      {},
      {
        envDefaultOverrides: {
          CACHE_TYPE: 'redis',
          CACHE_REDIS_PORT: 6000,
          CACHE_LOCK_DURATION: 100,
          CACHE_LOCK_RETRIES: 1,
        },
      },
    )
    const adapter2 = new Adapter({
      name: 'TEST',
      defaultEndpoint: 'test',
      config: config2,
      endpoints: [
        new AdapterEndpoint({
          name: 'nowork',
          transport: new NopTransport(),
        }),
      ],
    })

    const redisClient = new RedisMock() as unknown as Redis
    const cache = new RedisCache(redisClient) // Fake redis
    const dependencies: Partial<AdapterDependencies> = {
      cache,
      redisClient,
    }

    try {
      await TestAdapter.start(adapter, t.context, dependencies)
      await sleep(1500)
      await TestAdapter.start(adapter2, t.context, dependencies)

      t.fail('An ExecutionError should have been thrown')
    } catch (error) {
      if (error instanceof ExecutionError) {
        t.is(error.message, 'The operation was unable to achieve a quorum during its retry window.')
      } else {
        t.fail('An ExecutionError should have been thrown')
      }
    }
  },
)

test.serial(
  'If an adapter shuts down, an adapter with the same key should successfully acquire a lock on retries',
  async (t) => {
    const config = new AdapterConfig(
      {},
      {
        envDefaultOverrides: {
          CACHE_TYPE: 'redis',
          CACHE_REDIS_PORT: 6000,
          CACHE_LOCK_DURATION: 1000,
        },
      },
    )
    const adapter = new Adapter({
      name: 'TEST',
      defaultEndpoint: 'test',
      config,
      endpoints: [
        new AdapterEndpoint({
          name: 'nowork',
          transport: new NopTransport(),
        }),
      ],
    })

    const config2 = new AdapterConfig(
      {},
      {
        envDefaultOverrides: {
          CACHE_TYPE: 'redis',
          CACHE_REDIS_PORT: 6000,
          CACHE_LOCK_DURATION: 1000,
          CACHE_LOCK_RETRIES: 10,
        },
      },
    )
    const adapter2 = new Adapter({
      name: 'TEST',
      defaultEndpoint: 'test',
      config: config2,
      endpoints: [
        new AdapterEndpoint({
          name: 'nowork',
          transport: new NopTransport(),
        }),
      ],
    })

    const redisMock = new RedisMock()
    const redisClient = redisMock as unknown as Redis
    const cache = new RedisCache(redisClient) // Fake redis
    const dependencies: Partial<AdapterDependencies> = {
      cache,
      redisClient,
    }

    try {
      const testAdapter = await TestAdapter.start(adapter, t.context, dependencies)
      // Sleep for 1 second to allow the lock to be extended
      await sleep(1000)
      // Store the unique ID of the first adapter
      const firstAdapterID = redisMock.keys['TEST']
      // Shut down the first adapter
      await testAdapter.api.close()
      // Start the second adapter before deleting the old key
      TestAdapter.start(adapter2, t.context, dependencies)
      // Sleep to allow for retries
      await sleep(500)
      // Delete the old key from the first adapter
      delete redisMock.keys['TEST']
      // Sleep to allow the second adapter to acquire the lock on retry and extend
      await sleep(500)
      const secondAdapterID = redisMock.keys['TEST']
      // Assert that the second adapters unique ID is stored in the redisMock
      t.is(
        redisMock.keys['TEST'] !== firstAdapterID && redisMock.keys['TEST'] === secondAdapterID,
        true,
      )
    } catch (error) {
      t.fail(`The following error should not have been thrown: ${error}`)
    }
  },
)
