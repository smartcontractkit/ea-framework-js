import test from 'ava'
import { expose } from '../src'
import { Adapter, AdapterEndpoint } from '../src/adapter'
import { NopTransport } from './util'

test('duplicate endpoint names throw error on startup', async (t) => {
  const adapter = new Adapter({
    name: 'TEST',
    endpoints: [
      new AdapterEndpoint({
        name: 'test',
        inputParameters: {},
        transport: new NopTransport(),
      }),
      new AdapterEndpoint({
        name: 'another',
        aliases: ['test'],
        inputParameters: {},
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
        inputParameters: {},
        transport: new NopTransport(),
      }),
    ],
  })

  await t.throwsAsync(async () => expose(adapter), {
    message: 'Adapter name must be uppercase',
  })
})
