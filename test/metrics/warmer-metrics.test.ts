import FakeTimers, { InstalledClock } from '@sinonjs/fake-timers'
import untypedTest, { TestFn } from 'ava'
import nock from 'nock'
import { runAllUntilTime, TestAdapter } from '../util'
import { buildHttpAdapter } from './helper'

const test = untypedTest as TestFn<{
  testAdapter: TestAdapter
  clock: InstalledClock
}>

const URL = 'http://test-url.com'
const endpoint = '/price'
const version = process.env['npm_package_version']

test.before(async (t) => {
  nock.disableNetConnect()
  nock.enableNetConnect('localhost')
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
  nock.restore()
  t.context.clock.uninstall()
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
  await t.context.testAdapter.startBackgroundExecuteThenGetResponse(t, {
    from,
    to,
  })

  const metricsMap = await t.context.testAdapter.getMetrics()

  let expectedLabel = `{isBatched="true",app_name="TEST",app_version="${version}"}`
  t.is(metricsMap.get(`cache_warmer_get_count${expectedLabel}`), 1)

  expectedLabel = `{endpoint="test",app_name="TEST",app_version="${version}"}`
  t.is(metricsMap.get(`bg_execute_total${expectedLabel}`), 3)

  expectedLabel = `{endpoint="test",transport_type="MockHttpTransport",app_name="TEST",app_version="${version}"}`
  t.is(metricsMap.get(`bg_execute_subscription_set_count${expectedLabel}`), 1)

  expectedLabel = `{endpoint="test",app_name="TEST",app_version="${version}"}`
  const responseTime = metricsMap.get(`bg_execute_duration_seconds${expectedLabel}`)
  if (responseTime !== undefined) {
    t.is(typeof responseTime === 'number', true)
    t.is(responseTime > 0, true)
  } else {
    t.fail('Response time did not record')
  }

  // Wait until the cache expires, and the subscription is out
  await runAllUntilTime(t.context.clock, 15000) // The provider response is slower

  // Now that the cache is out and the subscription no longer there, this should time out
  const error2 = await t.context.testAdapter.request({
    from,
    to,
  })
  t.is(error2?.statusCode, 504)

  const metricsMap2 = await t.context.testAdapter.getMetrics()

  expectedLabel = `{isBatched="true",app_name="TEST",app_version="${version}"}`
  t.is(metricsMap2.get(`cache_warmer_get_count${expectedLabel}`), 0)

  expectedLabel = `{endpoint="test",app_name="TEST",app_version="${version}"}`
  t.is(metricsMap2.get(`bg_execute_total${expectedLabel}`), 17)

  expectedLabel = `{endpoint="test",transport_type="MockHttpTransport",app_name="TEST",app_version="${version}"}`
  t.is(metricsMap2.get(`bg_execute_subscription_set_count${expectedLabel}`), 0)
})
