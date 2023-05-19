import FakeTimers, { InstalledClock } from '@sinonjs/fake-timers'
import untypedTest, { TestFn } from 'ava'
import { TestAdapter } from '../../src/util/testing-utils'
import { buildHttpAdapter } from './helper'
import MockAdapter from 'axios-mock-adapter'
import axios from 'axios'

const test = untypedTest as TestFn<{
  testAdapter: TestAdapter
  clock: InstalledClock
}>

const URL = 'http://test-url.com'
const endpoint = '/price'
const axiosMock = new MockAdapter(axios)

test.before(async (t) => {
  process.env['METRICS_ENABLED'] = 'true'
  // Set higher retries for polling metrics testing
  process.env['CACHE_POLLING_MAX_RETRIES'] = '5'

  const adapter = buildHttpAdapter()

  // Start the adapter
  t.context.clock = FakeTimers.install()
  t.context.testAdapter = await TestAdapter.startWithMockedCache(adapter, t.context)
})

test.after((t) => {
  axiosMock.reset()
  t.context.clock.uninstall()
})

const from = 'ETH'
const to = 'USD'
const price = 1234

axiosMock
  .onPost(URL + endpoint, {
    pairs: [
      {
        base: from,
        quote: to,
      },
    ],
  })
  .reply(200, {
    prices: [
      {
        pair: `${from}/${to}`,
        price,
      },
    ],
  })

test.serial('Test cache warmer active metric', async (t) => {
  const error = await t.context.testAdapter.request({ from, to })
  t.is(error.statusCode, 504)

  const metrics = await t.context.testAdapter.getMetrics()
  metrics.assert(t, {
    name: 'transport_polling_failure_count',
    labels: { adapter_endpoint: 'test' },
    expectedValue: 1,
  })
  metrics.assertPositiveNumber(t, {
    name: 'transport_polling_duration_seconds',
    labels: {
      adapter_endpoint: 'test',
      succeeded: 'false',
    },
  })
})
