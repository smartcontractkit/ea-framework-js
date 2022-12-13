import FakeTimers from '@sinonjs/fake-timers'
import untypedTest, { TestFn } from 'ava'
import axios, { AxiosError } from 'axios'
import { AddressInfo } from 'net'
import nock from 'nock'
import { expose } from '../../src'
import { MockCache, runAllUntilTime } from '../util'
import { buildHttpAdapter, parsePromMetrics } from './helper'

const test = untypedTest as TestFn<{
  serverAddress: string
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
  // Set unique port between metrics tests to avoid conflicts in metrics servers
  process.env['METRICS_PORT'] = '9092'
  // Disable retries to make the testing flow easier
  process.env['CACHE_POLLING_MAX_RETRIES'] = '0'
  // So that we don't have to wait that long in the test for the subscription to expire
  process.env['WARMUP_SUBSCRIPTION_TTL'] = '5000'
  // So that we don't see errors from the mocked clock running until axios' http timeout timer
  process.env['API_TIMEOUT'] = '0'
  process.env['RATE_LIMIT_CAPACITY_SECOND'] = '1'
  process.env['CACHE_MAX_AGE'] = '2000'

  const adapter = buildHttpAdapter()

  // Create mocked cache so we can listen when values are set
  // This is a more reliable method than expecting precise clock timings
  const mockCache = new MockCache(adapter.config.CACHE_MAX_ITEMS)

  // Start the adapter
  const api = await expose(adapter, {
    cache: mockCache,
  })
  t.context.serverAddress = `http://localhost:${(api?.server.address() as AddressInfo)?.port}`
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
  const makeRequest = () =>
    axios.post(t.context.serverAddress, {
      data: {
        from,
        to,
      },
    })

  // Expect the first response to time out
  // The polling behavior is tested in the cache tests, so this is easier here.
  // Start the request:
  const errorPromise: Promise<AxiosError | undefined> = t.throwsAsync(makeRequest)
  // Advance enough time for the initial request async flow
  clock.tickAsync(10)
  // Wait for the failed cache get -> instant 504
  const error = await errorPromise
  t.is(error?.response?.status, 504)

  // Advance clock so that the batch warmer executes once again and wait for the cache to be set
  const cacheValueSetPromise = t.context.cache.waitForNextSet()
  await cacheValueSetPromise

  // Second request should find the response in the cache
  let response = await makeRequest()

  t.is(response.status, 200)
  const metricsAddress = `http://localhost:${process.env['METRICS_PORT']}/metrics`
  response = await axios.get(metricsAddress)
  let metricsMap = parsePromMetrics(response.data)

  let expectedLabel = `{isBatched="true",app_name="TEST",app_version="${version}"}`
  t.is(metricsMap.get(`cache_warmer_get_count${expectedLabel}`), 1)

  expectedLabel = `{endpoint="test",app_name="TEST",app_version="${version}"}`
  t.is(metricsMap.get(`bg_execute_total${expectedLabel}`), 2)

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
  await runAllUntilTime(clock, 15000) // The provider response is slower

  // Now that the cache is out and the subscription no longer there, this should time out
  const error2: AxiosError | undefined = await t.throwsAsync(makeRequest)
  t.is(error2?.response?.status, 504)

  response = await axios.get(metricsAddress)
  metricsMap = parsePromMetrics(response.data)

  expectedLabel = `{isBatched="true",app_name="TEST",app_version="${version}"}`
  t.is(metricsMap.get(`cache_warmer_get_count${expectedLabel}`), 0)

  expectedLabel = `{endpoint="test",app_name="TEST",app_version="${version}"}`
  t.is(metricsMap.get(`bg_execute_total${expectedLabel}`), 18)

  expectedLabel = `{endpoint="test",transport_type="MockHttpTransport",app_name="TEST",app_version="${version}"}`
  t.is(metricsMap.get(`bg_execute_subscription_set_count${expectedLabel}`), 0)
})
