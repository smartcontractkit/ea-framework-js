import FakeTimers, { InstalledClock } from '@sinonjs/fake-timers'
import untypedTest, { TestFn } from 'ava'
import { start } from '../src'
import { Adapter, AdapterEndpoint, EndpointContext } from '../src/adapter'
import { deferredPromise, NopTransport, NopTransportTypes, TestAdapter } from './util'

const test = untypedTest as TestFn<{
  testAdapter: TestAdapter
  clock: InstalledClock
}>

test.serial('background executor calls transport function with background context', async (t) => {
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

  await start(adapter)
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

  const server = await start(adapter)
  t.is(timesCalled, 1)
  server.api?.close()
  await clock.tickAsync(999999)
  t.is(timesCalled, 1) // The background process closed, so this was never called again

  clock.uninstall()
})

test.serial('background executor error does not stop the loop', async (t) => {
  let iteration = 0
  const [promise, resolve] = deferredPromise<EndpointContext<NopTransportTypes>>()

  const transport = new (class extends NopTransport {
    async backgroundExecute(context: EndpointContext<NopTransportTypes>): Promise<void> {
      if (iteration === 0) {
        iteration++
        throw new Error('Forced bg execute error')
      }
      resolve(context)
    }
  })()

  process.env['METRICS_ENABLED'] = 'true'
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

  const testAdapter = await TestAdapter.start(adapter, t.context)
  const context = await promise
  t.is(context.endpointName, 'test')
  const metrics = await testAdapter.getMetrics()

  metrics.assert(t, {
    name: 'bg_execute_errors',
    labels: {
      adapter_endpoint: 'test',
      transport: 'default_single_transport',
    },
    expectedValue: 1,
  })
  metrics.assert(t, {
    name: 'bg_execute_total',
    labels: {
      adapter_endpoint: 'test',
      transport: 'default_single_transport',
    },
    expectedValue: 5,
  })
})
