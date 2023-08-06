import untypedTest, { TestFn } from 'ava'
import { Redis } from 'ioredis'
import { expose, getTLSOptions, start } from '../src'
import { Adapter, AdapterDependencies, AdapterEndpoint } from '../src/adapter'
import { RedisCache } from '../src/cache'
import { AdapterConfig, buildAdapterSettings } from '../src/config'
import { NopTransport, RedisMock, TestAdapter } from '../src/util/testing-utils'

const test = untypedTest as TestFn<{
  testAdapter: TestAdapter
}>

test.beforeEach(async (t) => {
  const adapter = new Adapter({
    name: 'TEST',
    endpoints: [
      new AdapterEndpoint({
        name: 'test',
        transport: new NopTransport(),
      }),
    ],
  })

  t.context.testAdapter = await TestAdapter.start(adapter, t.context)
})

test('health endpoint returns health OK', async (t) => {
  const response = await t.context.testAdapter.getHealth()
  t.deepEqual(response.json(), {
    message: 'OK',
    version: process.env['npm_package_version'],
  })
})

test('MTLS_ENABLED with no TLS params should error', async (t) => {
  const config = new AdapterConfig(
    {},
    {
      envDefaultOverrides: {
        MTLS_ENABLED: true,
      },
    },
  )
  const adapter = new Adapter({
    name: 'TEST',
    config,
    endpoints: [
      new AdapterEndpoint({
        name: 'test',
        transport: new NopTransport(),
      }),
    ],
  })
  try {
    await start(adapter)
  } catch (e: unknown) {
    t.is(
      (e as Error).message,
      'TLS_PRIVATE_KEY, TLS_PUBLIC_KEY, and TLS_CA environment variables are required when MTLS_ENABLED is set to true.',
    )
  }
})

test('Having both TLS_ENABLED and MTLS_ENABLED should throw an error', async (t) => {
  const config = new AdapterConfig(
    {},
    {
      envDefaultOverrides: {
        MTLS_ENABLED: true,
        TLS_ENABLED: true,
      },
    },
  )
  const adapter = new Adapter({
    name: 'TEST',
    config,
    endpoints: [
      new AdapterEndpoint({
        name: 'test',
        transport: new NopTransport(),
      }),
    ],
  })
  try {
    await start(adapter)
  } catch (e: unknown) {
    t.is((e as Error).message, 'TLS_ENABLED and MTLS_ENABLED cannot both be set to true.')
  }
})

test('MTLS_ENABLED connection with incorrect params should error', async (t) => {
  const config = new AdapterConfig(
    {},
    {
      envDefaultOverrides: {
        MTLS_ENABLED: true,
        TLS_PRIVATE_KEY: 'dGVzdA==',
        TLS_PUBLIC_KEY: 'dGVzdA==',
        TLS_CA: 'dGVzdA==',
      },
    },
  )
  const adapter = new Adapter({
    name: 'TEST',
    config,
    endpoints: [
      new AdapterEndpoint({
        name: 'test',
        transport: new NopTransport(),
      }),
    ],
  })
  try {
    await start(adapter)
  } catch (e: unknown) {
    t.pass()
  }
})

test('getTLSOptions should return an empty object if TLS and mTLS are not enabled', async (t) => {
  const adapterSettings = buildAdapterSettings({})
  t.deepEqual(getTLSOptions(adapterSettings), {})
})

test('requestCert should be false when TLS_ENABLED is set to true', async (t) => {
  const adapterSettings = buildAdapterSettings({})
  adapterSettings.TLS_ENABLED = true
  adapterSettings.TLS_PRIVATE_KEY = 'dGVzdA=='
  adapterSettings.TLS_PUBLIC_KEY = 'dGVzdA=='
  adapterSettings.TLS_CA = 'dGVzdA=='
  t.deepEqual(getTLSOptions(adapterSettings), {
    https: {
      key: 'dGVzdA==',
      cert: 'dGVzdA==',
      ca: 'dGVzdA==',
      passphrase: '',
      requestCert: false,
    },
  })
})

test('requestCert should be true when MTLS_ENABLED is set to true', async (t) => {
  const adapterSettings = buildAdapterSettings({})
  adapterSettings.MTLS_ENABLED = true
  adapterSettings.TLS_PRIVATE_KEY = 'dGVzdA=='
  adapterSettings.TLS_PUBLIC_KEY = 'dGVzdA=='
  adapterSettings.TLS_CA = 'dGVzdA=='
  t.deepEqual(getTLSOptions(adapterSettings), {
    https: {
      key: 'dGVzdA==',
      cert: 'dGVzdA==',
      ca: 'dGVzdA==',
      passphrase: '',
      requestCert: true,
    },
  })
})

test('Adapter writer mode api disabled', async (t) => {
  process.env['CACHE_TYPE'] = 'redis'
  const config = new AdapterConfig(
    {},
    {
      envDefaultOverrides: {
        EA_MODE: 'writer',
        CACHE_LOCK_DEFERRAL_MS: 0,
      },
    },
  )

  const adapter = new Adapter({
    name: 'TEST',
    config,
    endpoints: [
      new AdapterEndpoint({
        name: 'test',
        transport: new NopTransport(),
      }),
    ],
  })

  const cache = new RedisCache(new RedisMock() as unknown as Redis) // Fake redis
  const dependencies: Partial<AdapterDependencies> = {
    cache,
  }

  const api = await expose(adapter, dependencies)
  t.is(api, undefined)
})

test('Initialize adapter (error)', async (t) => {
  try {
    await start({} as Adapter)
  } catch (e: unknown) {
    t.is(
      (e as Error).message,
      'The adapter has not been initialized as an instance of the Adapter class, exiting.',
    )
  }
})

test('Initialize adapter twice (error)', async (t) => {
  const adapter = new Adapter({
    name: 'TEST',
    endpoints: [
      new AdapterEndpoint({
        name: 'test',
        transport: new NopTransport(),
      }),
    ],
  })

  const cache = new RedisCache(new RedisMock() as unknown as Redis) // Fake redis
  const dependencies: Partial<AdapterDependencies> = {
    cache,
  }

  try {
    await start(adapter, dependencies)
    await start(adapter, dependencies)
    t.fail()
  } catch (e: unknown) {
    t.is((e as Error).message, 'This adapter has already been initialized!')
  }
})

test('Throw error if EA mode is not RW and cache type is local', async (t) => {
  process.env['CACHE_TYPE'] = 'local'
  const config = new AdapterConfig(
    {},
    {
      envDefaultOverrides: {
        EA_MODE: 'writer',
      },
    },
  )

  const adapter = new Adapter({
    name: 'TEST',
    config,
    endpoints: [
      new AdapterEndpoint({
        name: 'test',
        transport: new NopTransport(),
      }),
    ],
  })

  try {
    await expose(adapter)
  } catch (e: unknown) {
    t.is((e as Error).message, 'EA mode cannot be writer while cache type is local')
  }
})
