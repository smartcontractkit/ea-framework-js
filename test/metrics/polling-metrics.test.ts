import FakeTimers from '@sinonjs/fake-timers'
import untypedTest, { TestFn } from 'ava'
import nock from 'nock'
import { MockCache, TestAdapter } from '../util'
import { buildHttpAdapter, parsePromMetrics } from './helper'

const test = untypedTest as TestFn<{
  testAdapter: TestAdapter
  cache: MockCache
}>

const URL = 'http://test-url.com'
const endpoint = '/price'
const version = process.env['npm_package_version']

const clock = FakeTimers.install({ shouldAdvanceTime: true, advanceTimeDelta: 100 })

test.before(async (t) => {
  nock.disableNetConnect()
  nock.enableNetConnect('localhost')
  process.env['METRICS_ENABLED'] = 'true'
  // Set higher retries for polling metrics testing
  process.env['CACHE_POLLING_MAX_RETRIES'] = '5'

  const adapter = buildHttpAdapter()

  // Create mocked cache so we can listen when values are set
  // This is a more reliable method than expecting precise clock timings
  const mockCache = new MockCache(adapter.config.CACHE_MAX_ITEMS)

  // Start the adapter
  t.context.testAdapter = await TestAdapter.start(adapter, t.context, { cache: mockCache })
  t.context.cache = mockCache
})

test.after(() => {
  nock.restore()
  clock.uninstall()
})

const from = 'ETH'
const to = 'USD'
const price = 1234

nock(URL)
  .post(endpoint, {
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
  .persist()

test.serial('Test cache warmer active metric', async (t) => {
  const error = await t.context.testAdapter.request({ from, to })
  t.is(error?.statusCode, 504)

  const response = await t.context.testAdapter.getMetrics()
  const metricsMap = parsePromMetrics(response)

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
