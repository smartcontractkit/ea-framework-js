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
