import untypedTest, { TestFn } from 'ava'
import axios, { AxiosError } from 'axios'
import { AddressInfo } from 'net'
import nock from 'nock'
import { expose } from '../../src'
import { Adapter } from '../../src/adapter'
import { sleep } from '../../src/util'
import { assertEqualResponses, deferredPromise } from '../util'
import { createAdapterEndpoint, ProviderResponseBody } from './helper'

const test = untypedTest as TestFn<{
  serverAddress: string
}>

const URL = 'http://test-url.com'
const endpoint = '/price'

test.before(() => {
  nock.disableNetConnect()
  nock.enableNetConnect('localhost')
})

test.after(() => {
  nock.restore()
})

const from = 'ETH'
const to = 'USD'
const price = 1234

test('sends request to DP and returns response', async (t) => {
  const adapter = new Adapter({
    name: 'TEST',
    defaultEndpoint: 'test',
    endpoints: [createAdapterEndpoint()],
  })

  const api = await expose(adapter)
  const address = `http://localhost:${(api?.server.address() as AddressInfo)?.port}`

  nock(URL)
    .get(endpoint)
    .query({
      base: from,
      quote: to,
    })
    .reply(200, {
      price,
      verbose: 'DP data',
    })

  const response = await axios.post(address, {
    data: {
      from,
      to,
    },
  })

  t.is(response.status, 200)
  assertEqualResponses(t, response.data, {
    data: { price },
    result: price,
    statusCode: 200,
  })
})

test('sends request to DP and returns response (verbose)', async (t) => {
  const adapter = new Adapter({
    name: 'TEST',
    defaultEndpoint: 'test',
    endpoints: [createAdapterEndpoint()],
    envDefaultOverrides: {
      API_VERBOSE: true,
    },
  })

  const api = await expose(adapter)
  const address = `http://localhost:${(api?.server.address() as AddressInfo)?.port}`

  nock(URL)
    .get(endpoint)
    .query({
      base: 'qwe',
      quote: 'rte',
    })
    .reply(200, {
      price,
      verbose: 'DP data',
    })

  const response = await axios.post(address, {
    data: {
      from: 'qwe',
      to: 'rte',
    },
  })

  t.is(response.status, 200)
  assertEqualResponses(t, response.data, {
    data: {
      price: 1234,
      verbose: 'DP data',
    },
    statusCode: 200,
    result: price,
  })
})

test('identical request to EA is coalesced and returned from cache', async (t) => {
  const adapter = new Adapter({
    name: 'TEST',
    defaultEndpoint: 'test',
    endpoints: [createAdapterEndpoint()],
  })

  const api = await expose(adapter)
  const address = `http://localhost:${(api?.server.address() as AddressInfo)?.port}`

  const [promise, resolve] = deferredPromise<ProviderResponseBody>()
  nock(URL)
    .get(endpoint)
    .query({
      base: from,
      quote: to,
    })
    .reply(200, () => promise)

  // Send first request, that will be blocked until we resolve the promise
  const request1 = axios.post(address, {
    data: {
      from,
      to,
    },
  })
  await sleep(1) // To ensure all inner ops move along

  // Send second request, and wait for response.
  // This one will be coalesced with the first one, and made to wait until the cache is filled.
  // We know it's not going to the DP twice, because Nock would block it.
  const request2 = axios.post(address, {
    data: {
      from,
      to,
    },
  })
  await sleep(1) // To ensure all inner ops move along

  // Resolve the promise
  resolve({
    price,
  })

  const responses = await Promise.all([request1, request2])

  for (const response of responses) {
    t.is(response.status, 200)
    assertEqualResponses(t, response.data, {
      data: { price },
      result: price,
      statusCode: 200,
    })
  }
})

test('rate limits (per second) incoming request (without retries)', async (t) => {
  const adapter = new Adapter({
    name: 'TEST',
    defaultEndpoint: 'test',
    endpoints: [createAdapterEndpoint()],
    rateLimiting: {
      tiers: {
        base: {
          rateLimit1m: 1,
        },
      },
    },
    envDefaultOverrides: {
      REST_TRANSPORT_MAX_RATE_LIMIT_RETRIES: 0,
    },
  })

  const api = await expose(adapter)
  const address = `http://localhost:${(api?.server.address() as AddressInfo)?.port}`

  const payloads = [
    {
      base: 'ETH',
      quote: 'BTC',
    },
    {
      base: 'ETH',
      quote: 'USD',
    },
  ]

  payloads.forEach((p) => {
    nock(URL)
      .get(endpoint)
      .query(p)
      .reply(200, {
        price,
      })
      .persist()
  })

  const makeRequest = ({ base, quote }: { base: string; quote: string }) =>
    axios.post(address, {
      data: {
        from: base,
        to: quote,
      },
    })

  const error: AxiosError | undefined = await t.throwsAsync(() =>
    Promise.all(payloads.map((p) => makeRequest(p))),
  )
  t.is(error?.response?.status, 504)
})
