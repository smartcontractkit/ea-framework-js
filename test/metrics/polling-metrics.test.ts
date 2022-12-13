import FakeTimers from '@sinonjs/fake-timers'
import untypedTest, { TestFn } from 'ava'
import axios, { AxiosError } from 'axios'
import { AddressInfo } from 'net'
import nock from 'nock'
import { expose } from '../../src'
import { MockCache } from '../util'
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
  process.env['METRICS_PORT'] = '9094'
  // Set higher retries for polling metrics testing
  process.env['CACHE_POLLING_MAX_RETRIES'] = '5'

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

  const metricsAddress = `http://localhost:${process.env['METRICS_PORT']}/metrics`
  const response = await axios.get(metricsAddress)
  const metricsMap = parsePromMetrics(response.data)

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
