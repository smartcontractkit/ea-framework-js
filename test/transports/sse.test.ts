import FakeTimers, { InstalledClock } from '@sinonjs/fake-timers'
import untypedTest, { TestFn } from 'ava'
import axios, { AxiosRequestConfig } from 'axios'
import MockAdapter from 'axios-mock-adapter'
import { Adapter, AdapterEndpoint } from '../../src/adapter'
import { BaseAdapterSettings, AdapterConfig } from '../../src/config'
import { SSEConfig, SseTransport } from '../../src/transports'
import { ProviderResult, SingleNumberResultResponse } from '../../src/util'
import { InputParameters } from '../../src/validation'
import { TestAdapter } from '../util'
const { MockEvent, EventSource } = require('mocksse') // eslint-disable-line

const URL = 'http://test.com'
const axiosMock = new MockAdapter(axios)

const test = untypedTest as TestFn<{
  clock: InstalledClock
  testAdapter: TestAdapter
}>

interface AdapterRequestParams {
  base: string
  quote: string
}

export const inputParameters = {
  base: {
    type: 'string',
    required: true,
  },
  quote: {
    type: 'string',
    required: true,
  },
} satisfies InputParameters

type StreamEndpointTypes = {
  Request: {
    Params: AdapterRequestParams
  }
  Response: SingleNumberResultResponse
  Settings: BaseAdapterSettings
  Provider: {
    RequestBody: never
  }
}

export const sseTransport: SseTransport<StreamEndpointTypes> = new SseTransport({
  prepareSSEConnectionConfig: (): SSEConfig => {
    return { url: URL }
  },
  prepareKeepAliveRequest: (): AxiosRequestConfig<never> => {
    const axiosRequestConfig: AxiosRequestConfig<never> = {
      method: 'POST',
      url: `${URL}/ping`,
    }
    return axiosRequestConfig
  },
  prepareSubscriptionRequest: (): AxiosRequestConfig<never> => {
    const axiosConfig: AxiosRequestConfig<never> = {
      method: 'POST',
      url: `${URL}/sub`,
    }
    return axiosConfig
  },
  prepareUnsubscriptionRequest: (): AxiosRequestConfig<never> => {
    const axiosConfig: AxiosRequestConfig<never> = {
      method: 'POST',
      url: `${URL}/unsub`,
    }
    return axiosConfig
  },
  eventListeners: [
    {
      type: 'price',
      parseResponse: (evt: MessageEvent): ProviderResult<StreamEndpointTypes>[] => {
        return [
          {
            params: { base: evt.data.base, quote: evt.data.quote },
            response: {
              data: {
                result: evt.data.price,
              },
              result: evt.data.price,
            },
          },
        ]
      },
    },
  ],
})

export const sseEndpoint = new AdapterEndpoint({
  name: 'test',
  transport: sseTransport,
  inputParameters,
})

const CACHE_MAX_AGE = 4000
const BACKGROUND_EXECUTE_MS_SSE = 5000

// Disable retries to make the testing flow easier
process.env['CACHE_POLLING_MAX_RETRIES'] = '0'

const config = new AdapterConfig(
  {},
  {
    envDefaultOverrides: {
      CACHE_MAX_AGE,
      BACKGROUND_EXECUTE_MS_SSE,
    },
  },
)

const adapter = new Adapter({
  name: 'TEST',
  defaultEndpoint: 'test',
  config,
  endpoints: [sseEndpoint],
})

const mockSSE = () => {
  const mock = new MockEvent({
    url: URL,
    setInterval: 10,
    responses: [
      {
        type: 'price',
        data: { base: 'ETH', quote: 'USD', price: 111 },
        lastEventId: '0000000',
        origin: URL,
      },
    ],
  })
  return mock
}

const mockHTTP = () => {
  axiosMock
    .onPost(`${URL}/sub`)
    .reply(200, {
      message: 'Successfully subscribed to ETH/USD',
    })
    .onPost(`${URL}/unsub`)
    .reply(200, {
      message: 'Successfully unsubscribed from ETH/USD',
    })
    .onPost(`${URL}/ping`)
    .reply(200, {
      message: 'Pong',
    })
}

test('connects to EventSource, subscribes, gets message, unsubscribes and handles misconfigured subscription', async (t) => {
  t.context.clock = FakeTimers.install()

  // Mocks SSE events which are handled by the mock EventListener dependency
  mockSSE()
  mockHTTP()

  const base = 'ETH'
  const quote = 'USD'
  const price = 111

  // Start up adapter
  const testAdapter = await TestAdapter.startWithMockedCache(adapter, t.context, {
    eventSource: EventSource,
  })

  await testAdapter.startBackgroundExecuteThenGetResponse(t, {
    requestData: { base, quote },
    expectedResponse: {
      data: { result: 111 },
      result: price,
      statusCode: 200,
    },
  })

  // Make a request for an unsupported ticker symbol
  const error = await testAdapter.request({
    base: 'NONE',
    quote: 'USD',
  })
  t.is(error.statusCode, 504)

  // Wait until the cache expires, and the subscription is out
  await t.context.clock.tickAsync(11000)

  // Now that the cache is out and the subscription no longer there, this should time out
  const error2 = await testAdapter.request({
    base,
    quote,
  })
  t.is(error2.statusCode, 504)

  t.context.clock.uninstall()
})
