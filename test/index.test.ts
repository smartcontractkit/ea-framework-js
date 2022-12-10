import untypedTest, { TestFn } from 'ava'
import axios from 'axios'
import { AddressInfo } from 'net'
import { expose } from '../src'
import { Adapter, AdapterEndpoint } from '../src/adapter'
import { NopTransport } from './util'

const test = untypedTest as TestFn<{
  serverAddress: string
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

  const api = await expose(adapter)
  if (!api) {
    throw 'Server did not start'
  }
  t.context.serverAddress = `http://localhost:${(api.server.address() as AddressInfo).port}`
})

test('health endpoint returns health OK', async (t) => {
  const response = await axios.get(`${t.context.serverAddress}/health`)
  t.deepEqual(response.data, {
    message: 'OK',
    version: process.env['npm_package_version'],
  })
})

test('MTLS_ENABLED with no TLS params should error', async (t) => {
  const adapter = new Adapter({
    name: 'TEST',
    endpoints: [
      new AdapterEndpoint({
        name: 'test',
        inputParameters: {},
        transport: new NopTransport(),
      }),
    ],
    envDefaultOverrides: {
      MTLS_ENABLED: true,
    },
  })
  try {
    await expose(adapter)
  } catch (e: unknown) {
    t.is(
      (e as Error).message,
      'TLS_PRIVATE_KEY , TLS_PUBLIC_KEY and  TLS_CA environment variables are required when MTLS_ENABLED is set to true.',
    )
  }
  // Const api = await expose(adapter)
  // const serverAddress = `https://localhost:${(api?.server?.address() as AddressInfo).port}`
  // t.is(api?.initialConfig?.https, true)
  //
  // const error = await t.throwsAsync(async () => {
  //   return await axios.get(`${serverAddress}/health`)
  // });
  // t.pass()
})

test('MTLS_ENABLED connection with incorrect params should error', async (t) => {
  const adapter = new Adapter({
    name: 'TEST',
    endpoints: [
      new AdapterEndpoint({
        name: 'test',
        inputParameters: {},
        transport: new NopTransport(),
      }),
    ],
    envDefaultOverrides: {
      MTLS_ENABLED: true,
      TLS_PRIVATE_KEY: 'test',
      TLS_PUBLIC_KEY: 'test',
      TLS_CA: 'test',
    },
  })
  try {
    await expose(adapter)
  } catch (e: unknown) {
    t.pass()
  }
})

test('Adapter writer mode api disabled', async (t) => {
  const adapter = new Adapter({
    name: 'TEST',
    endpoints: [
      new AdapterEndpoint({
        name: 'test',
        inputParameters: {},
        transport: new NopTransport(),
      }),
    ],
    envDefaultOverrides: {
      EA_MODE: 'writer',
    },
  })

  const api = await expose(adapter)
  t.is(api, undefined)
})

test('Initialize adapter (error)', async (t) => {
  try {
    await expose({} as Adapter)
  } catch (e: unknown) {
    t.is(
      (e as Error).message,
      'The adapter has not been initialized as an instance of the Adapter class, exiting.',
    )
  }
})
