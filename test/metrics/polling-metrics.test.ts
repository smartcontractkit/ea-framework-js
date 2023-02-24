import FakeTimers, { InstalledClock } from '@sinonjs/fake-timers'
import untypedTest, { TestFn } from 'ava'
import { TestAdapter } from '../util'
import { buildHttpAdapter } from './helper'
import MockAdapter from 'axios-mock-adapter'
import axios from 'axios'

const test = untypedTest as TestFn<{
  testAdapter: TestAdapter
  clock: InstalledClock
}>

const URL = 'http://test-url.com'
const endpoint = '/price'
const version = process.env['npm_package_version']
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

  const metricsMap = await t.context.testAdapter.getMetrics()

  let expectedLabel = `{endpoint="test",app_name="TEST",app_version="${version}"}`
  t.is(metricsMap.get(`transport_polling_failure_count${expectedLabel}`), 1)

  expectedLabel = `{endpoint="test",succeeded="false",app_name="TEST",app_version="${version}"}`
  const responseTime = metricsMap.get(`transport_polling_duration_seconds${expectedLabel}`)
  if (responseTime !== undefined) {
    t.is(typeof responseTime === 'number', true)
    t.is(responseTime > 0, true)
  } else {
    t.fail('Response time did not record')
  }
})
