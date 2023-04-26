import test from 'ava'
import { expose, start } from '../src'
import { Adapter, AdapterEndpoint } from '../src/adapter'
import { NopTransport, TestAdapter } from './util'

test('duplicate endpoint names throw error on startup', async (t) => {
  const adapter = new Adapter({
    name: 'TEST',
    endpoints: [
      new AdapterEndpoint({
        name: 'test',
        transport: new NopTransport(),
      }),
      new AdapterEndpoint({
        name: 'another',
        aliases: ['test'],
        transport: new NopTransport(),
      }),
    ],
  })

  await t.throwsAsync(async () => expose(adapter), {
    message: 'Duplicate endpoint / alias: "test"',
  })
})

test('lowercase adapter name throws error on startup', async (t) => {
  const adapter = new Adapter({
    // @ts-expect-error - tests that lowercase names throw errors in runtime
    name: 'test',
    endpoints: [
      new AdapterEndpoint({
        name: 'test',
        transport: new NopTransport(),
      }),
    ],
  })

  await t.throwsAsync(async () => expose(adapter), {
    message: 'Adapter name must be uppercase',
  })
})

test('Bootstrap function runs if provided', async (t) => {
  const adapter = new Adapter({
    name: 'TEST',
    endpoints: [
      new AdapterEndpoint({
        name: 'test',
        transport: new NopTransport(),
      }),
    ],
    bootstrap: async (ea) => {
      ea.name = 'BOOTSTRAPPED'
    },
  })
  await start(adapter)
  t.is(adapter.name, 'BOOTSTRAPPED')
})
test.serial('Throws when transport.registerRequest errors', async (t) => {
  const adapter = new Adapter({
    name: 'TEST',
    endpoints: [
      new AdapterEndpoint({
        name: 'test',
        transport: new (class extends NopTransport {
          async registerRequest() {
            throw new Error('Error from registerRequest')
          }
        })(),
      }),
    ],
  })

  const testAdapter = await TestAdapter.start(adapter, { testAdapter: {} as TestAdapter })
  const error = await testAdapter.request({
    endpoint: 'test',
  })

  t.is(error.statusCode, 500)
  t.is(error.body, 'Error from registerRequest')
})
