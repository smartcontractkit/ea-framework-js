import test from 'ava'
import FakeTimers from '@sinonjs/fake-timers'
import { expose } from '../src'
import { Adapter, EndpointContext, AdapterEndpoint } from '../src/adapter'
import { deferredPromise, NopTransport, NopTransportTypes } from './util'

test('background executor calls transport function with background context', async (t) => {
  const [promise, resolve] = deferredPromise<EndpointContext<NopTransportTypes>>()

  const transport = new (class extends NopTransport {
    async backgroundExecute(context: EndpointContext<NopTransportTypes>): Promise<void> {
      resolve(context)
    }
  })()

  const adapter = new Adapter({
    name: 'TEST',
    endpoints: [
      new AdapterEndpoint({
        name: 'test',
        inputParameters: {},
        transport,
      }),
      new AdapterEndpoint({
        name: 'skipped',
        inputParameters: {},
        transport: new NopTransport(), // Also add coverage for skipped executors
      }),
    ],
  })

  await expose(adapter)
  const context = await promise
  t.is(context.endpointName, 'test')
})

test.serial('background executor ends recursive chain on server close', async (t) => {
  const clock = FakeTimers.install()
  let timesCalled = 0

  const transport = new (class extends NopTransport {
    async backgroundExecute(): Promise<void> {
      timesCalled++
    }
  })()

  const adapter = new Adapter({
    name: 'TEST',
    endpoints: [
      new AdapterEndpoint({
        name: 'test',
        inputParameters: {},
        transport,
      }),
    ],
  })

  const server = await expose(adapter)
  if (!server) {
    throw 'Server did not start'
  }
  t.is(timesCalled, 1)
  server.close()
  await clock.tickAsync(999999)
  t.is(timesCalled, 1) // The background process closed, so this was never called again

  clock.uninstall()
})
