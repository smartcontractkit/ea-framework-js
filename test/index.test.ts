import untypedTest, { TestFn } from 'ava'
import { expose, start } from '../src'
import { Adapter, AdapterEndpoint } from '../src/adapter'
import { ProcessedConfig } from '../src/config'
import { NopTransport, TestAdapter } from './util'

const test = untypedTest as TestFn<{
  testAdapter: TestAdapter
}>

test.beforeEach(async (t) => {
  const adapter = new Adapter({
    name: 'TEST',
    endpoints: [
      new AdapterEndpoint({
        name: 'test',
        inputParameters: {},
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
  const processedConfig = new ProcessedConfig(
    {},
    {
      envDefaultOverrides: {
        MTLS_ENABLED: true,
      },
    },
  )
  const adapter = new Adapter({
    name: 'TEST',
    processedConfig,
    endpoints: [
      new AdapterEndpoint({
        name: 'test',
        inputParameters: {},
        transport: new NopTransport(),
      }),
    ],
  })
  try {
    await start(adapter)
  } catch (e: unknown) {
    t.is(
      (e as Error).message,
      'TLS_PRIVATE_KEY , TLS_PUBLIC_KEY and  TLS_CA environment variables are required when MTLS_ENABLED is set to true.',
    )
  }
})

test('MTLS_ENABLED connection with incorrect params should error', async (t) => {
  const processedConfig = new ProcessedConfig(
    {},
    {
      envDefaultOverrides: {
        MTLS_ENABLED: true,
        TLS_PRIVATE_KEY: 'test',
        TLS_PUBLIC_KEY: 'test',
        TLS_CA: 'test',
      },
    },
  )
  const adapter = new Adapter({
    name: 'TEST',
    processedConfig,
    endpoints: [
      new AdapterEndpoint({
        name: 'test',
        inputParameters: {},
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

test('Adapter writer mode api disabled', async (t) => {
  const processedConfig = new ProcessedConfig(
    {},
    {
      envDefaultOverrides: {
        EA_MODE: 'writer',
      },
    },
  )

  const adapter = new Adapter({
    name: 'TEST',
    processedConfig,
    endpoints: [
      new AdapterEndpoint({
        name: 'test',
        inputParameters: {},
        transport: new NopTransport(),
      }),
    ],
  })

  const api = await expose(adapter)
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
