import FakeTimers, { InstalledClock } from '@sinonjs/fake-timers'
import untypedTest, { TestFn } from 'ava'
import axios from 'axios'
import MockAdapter from 'axios-mock-adapter'
import { runAllUntilTime, TestAdapter } from '../util'
import { buildHttpAdapter } from './helper'

const test = untypedTest as TestFn<{
  testAdapter: TestAdapter
  clock: InstalledClock
}>

const URL = 'http://test-url.com'
const endpoint = '/price'
const axiosMock = new MockAdapter(axios)

test.before(async (t) => {
  process.env['METRICS_ENABLED'] = 'true'
  // Disable retries to make the testing flow easier
  process.env['CACHE_POLLING_MAX_RETRIES'] = '0'
  // So that we don't have to wait that long in the test for the subscription to expire
  process.env['WARMUP_SUBSCRIPTION_TTL'] = '5000'
  // So that we don't see errors from the mocked clock running until axios' http timeout timer
  process.env['API_TIMEOUT'] = '0'
  process.env['RATE_LIMIT_CAPACITY_SECOND'] = '1'
  process.env['CACHE_MAX_AGE'] = '2000'

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

test.serial('Test cache warmer active metric', async (t) => {
  axiosMock
    .onPost(URL + endpoint, {
      pairs: [
        {
          base: from,
          quote: to,
        },
      ],
    })
    .reply(() => {
      t.context.clock.tick(1)
      return [
        200,
        {
          prices: [
            {
              pair: `${from}/${to}`,
              price,
            },
          ],
        },
      ]
    })

  await t.context.testAdapter.startBackgroundExecuteThenGetResponse(t, {
    requestData: {
      from,
      to,
    },
  })

  let metrics = await t.context.testAdapter.getMetrics()
  metrics.assert(t, {
    name: 'cache_warmer_get_count',
    labels: { isBatched: 'true' },
    expectedValue: 1,
  })
  metrics.assert(t, {
    name: 'bg_execute_total',
    labels: { adapter_endpoint: 'test', transport: 'default_single_transport' },
    expectedValue: 2,
  })
  metrics.assert(t, {
    name: 'bg_execute_subscription_set_count',
    labels: { adapter_endpoint: 'test', transport_type: 'MockHttpTransport' },
    expectedValue: 1,
  })
  metrics.assertPositiveNumber(t, {
    name: 'bg_execute_duration_seconds',
    labels: { adapter_endpoint: 'test', transport: 'default_single_transport' },
  })

  // Wait until the cache expires, and the subscription is out
  await runAllUntilTime(t.context.clock, 10000) // The provider response is slower

  // Now that the cache is out and the subscription no longer there, this should time out
  const error2 = await t.context.testAdapter.request({
    from,
    to,
  })
  t.is(error2?.statusCode, 504)

  metrics = await t.context.testAdapter.getMetrics()
  metrics.assert(t, {
    name: 'cache_warmer_get_count',
    labels: { isBatched: 'true' },
    expectedValue: 0,
  })
  metrics.assert(t, {
    name: 'bg_execute_total',
    labels: { adapter_endpoint: 'test', transport: 'default_single_transport' },
    expectedValue: 12,
  })
  metrics.assert(t, {
    name: 'bg_execute_subscription_set_count',
    labels: { adapter_endpoint: 'test', transport_type: 'MockHttpTransport' },
    expectedValue: 0,
  })
})
