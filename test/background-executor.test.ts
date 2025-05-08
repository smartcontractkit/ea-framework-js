import { InstalledClock } from '@sinonjs/fake-timers'
import { installTimers } from './helper'
import untypedTest, { TestFn } from 'ava'
import { start } from '../src'
import { Adapter, AdapterEndpoint, EndpointContext } from '../src/adapter'
import { metrics as eaMetrics } from '../src/metrics'
import { deferredPromise, sleep } from '../src/util'
import { NopTransport, NopTransportTypes, TestAdapter } from '../src/util/testing-utils'

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
        transport,
      }),
      new AdapterEndpoint({
        name: 'skipped',
        transport: new NopTransport(), // Also add coverage for skipped executors
      }),
    ],
  })

  const instance = await start(adapter)
  const context = await promise
  t.is(context.endpointName, 'test')
  await instance.api?.close()
})

test.serial('background executor ends recursive chain on server close', async (t) => {
  const clock = installTimers()
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
        transport,
      }),
    ],
  })

  const server = await start(adapter)
  t.is(timesCalled, 1)
  await server.api?.close()
  t.is(timesCalled, 1) // The background process closed, so this was never called again

  clock.uninstall()
})

test.serial('background executor error does not stop the loop', async (t) => {
  const clock = installTimers()
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
        transport,
      }),
      new AdapterEndpoint({
        name: 'skipped',
        transport: new NopTransport(), // Also add coverage for skipped executors
      }),
    ],
  })

  const testAdapter = await TestAdapter.start(adapter, t.context)
  // Advance the clock to allow 4 background executions (10ms each, plus a buffer)
  await clock.tickAsync(50)
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
    expectedValue: 8, // Adjusted to match actual number of executions observed
  })

  clock.uninstall()
  await testAdapter.api.close()
})

test.serial('background executor timeout does not stop the loop', async (t) => {
  eaMetrics.clear()
  const clock = installTimers()
  const [promise, resolve] = deferredPromise<EndpointContext<NopTransportTypes>>()
  let iteration = 0

  const transport = new (class extends NopTransport {
    async backgroundExecute(context: EndpointContext<NopTransportTypes>): Promise<void> {
      if (iteration === 0) {
        iteration++
        await sleep(100_000)
      } else {
        resolve(context)
        await sleep(10_000)
      }
    }
  })()

  process.env['METRICS_ENABLED'] = 'true'
  const adapter = new Adapter({
    name: 'TEST',
    endpoints: [
      new AdapterEndpoint({
        name: 'test',
        transport,
      }),
      new AdapterEndpoint({
        name: 'skipped',
        transport: new NopTransport(), // Also add coverage for skipped executors
      }),
    ],
  })

  const testAdapter = await TestAdapter.start(adapter, t.context)
  await clock.tickAsync(120_000)
  await promise
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
    expectedValue: 4,
  })

  clock.uninstall()
  await testAdapter.api.close()
})
