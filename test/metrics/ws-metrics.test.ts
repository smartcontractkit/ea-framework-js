import FakeTimers from '@sinonjs/fake-timers'
import untypedTest, { TestFn } from 'ava'
import axios, { AxiosError } from 'axios'
import { Server, WebSocket } from 'mock-socket'
import { AddressInfo } from 'net'
import { expose } from '../../src'
import { Adapter, AdapterEndpoint } from '../../src/adapter'
import { SettingsMap } from '../../src/config'
import { WebSocketClassProvider, WebSocketTransport } from '../../src/transports'
import { InputParameters } from '../../src/validation'
import { MockCache } from '../util'
import { parsePromMetrics } from './helper'

export const test = untypedTest as TestFn<{
  serverAddress: string
  cache: MockCache
  adapterEndpoint: AdapterEndpoint<WebSocketEndpointTypes>
  server: Server
}>

interface AdapterRequestParams {
  base: string
  quote: string
}

export const inputParameters: InputParameters = {
  base: {
    type: 'string',
    required: true,
  },
  quote: {
    type: 'string',
    required: true,
  },
}

interface ProviderMessage {
  pair: string
  value: number
}

type WebSocketEndpointTypes = {
  Request: {
    Params: AdapterRequestParams
  }
  Response: {
    Data: {
      price: number
    }
    Result: number
  }
  CustomSettings: SettingsMap
  Provider: {
    WsMessage: ProviderMessage
  }
}

const BACKGROUND_EXECUTE_MS_WS = 5000
const URL = 'wss://test-ws.com/asd'
const version = process.env['npm_package_version']

/**
 * Sets the mocked websocket instance in the provided provider class.
 * We need this here, because the tests will connect using their instance of WebSocketClassProvider;
 * fetching from this library to the \@chainlink/ea-bootstrap package would access _another_ instance
 * of the same constructor. Although it should be a singleton, dependencies are different so that
 * means that the static classes themselves are also different.
 *
 * @param provider - singleton WebSocketClassProvider
 */
export const mockWebSocketProvider = (provider: typeof WebSocketClassProvider): void => {
  // Extend mock WebSocket class to bypass protocol headers error
  class MockWebSocket extends WebSocket {
    constructor(url: string, protocol: string | string[] | Record<string, string> | undefined) {
      super(url, protocol instanceof Object ? undefined : protocol)
    }
  }

  // Need to disable typing, the mock-socket impl does not implement the ws interface fully
  provider.set(MockWebSocket as any) // eslint-disable-line @typescript-eslint/no-explicit-any
}

export const websocketTransport = new WebSocketTransport<WebSocketEndpointTypes>({
  url: () => URL,
  handlers: {
    async open() {
      return
    },

    message(message) {
      const [base, quote] = message.pair.split('/')
      return [
        {
          params: { base, quote },
          response: {
            data: {
              price: message.value,
            },
            result: message.value,
          },
        },
      ]
    },
  },
  builders: {
    subscribeMessage: (params: AdapterRequestParams) => ({
      request: 'subscribe',
      pair: `${params.base}/${params.quote}`,
    }),
    unsubscribeMessage: (params: AdapterRequestParams) => ({
      request: 'unsubscribe',
      pair: `${params.base}/${params.quote}`,
    }),
  },
})

const base = 'ETH'
const quote = 'USD'
const price = 1234

export const webSocketEndpoint = new AdapterEndpoint({
  name: 'test',
  transport: websocketTransport,
  inputParameters,
})

const CACHE_MAX_AGE = 1000

process.env['METRICS_ENABLED'] = 'true'
// Set unique port between metrics tests to avoid conflicts in metrics servers
process.env['METRICS_PORT'] = '9093'
// Disable retries to make the testing flow easier
process.env['CACHE_POLLING_MAX_RETRIES'] = '0'

process.env['WS_SUBSCRIPTION_TTL'] = '10000'

const adapter = new Adapter({
  name: 'TEST',
  defaultEndpoint: 'test',
  endpoints: [webSocketEndpoint],
  envDefaultOverrides: {
    CACHE_MAX_AGE,
    BACKGROUND_EXECUTE_MS_WS,
  },
})

const clock = FakeTimers.install()

test.before(async (t) => {
  // Mock WS
  mockWebSocketProvider(WebSocketClassProvider)
  const mockWsServer = new Server(URL, { mock: false })
  mockWsServer.on('connection', (socket) => {
    let counter = 0
    const parseMessage = () => {
      if (counter++ === 0) {
        socket.send(
          JSON.stringify({
            pair: `${base}/${quote}`,
            value: price,
          }),
        )
      }
    }
    socket.on('message', parseMessage)
  })

  // Create mocked cache so we can listen when values are set
  // This is a more reliable method than expecting precise clock timings
  const mockCache = new MockCache()

  // Start up adapter
  const api = await expose(adapter, {
    cache: mockCache,
  })
  t.context.serverAddress = `http://localhost:${(api?.server.address() as AddressInfo)?.port}`
  t.context.cache = mockCache
  t.context.server = mockWsServer
})

test.after(async () => {
  clock.uninstall()
})

test.serial('Test WS connection, subscription, and message metrics', async (t) => {
  const makeRequest = () =>
    axios.post(t.context.serverAddress, {
      data: {
        base,
        quote,
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
  await clock.tickAsync(BACKGROUND_EXECUTE_MS_WS + 10)
  await cacheValueSetPromise

  // Second request should find the response in the cache
  let response = await makeRequest()

  t.is(response.status, 200)

  // Check connection, subscription active, subscription total, and message total metrics when subscribed to feed
  const metricsAddress = `http://localhost:${process.env['METRICS_PORT']}/metrics`
  response = await axios.get(metricsAddress)
  let metricsMap = parsePromMetrics(response.data)

  const basic = `app_name="TEST",app_version="${version}"`
  const feed = `feed_id="|base:eth|quote:usd",subscription_key="test-|base:eth|quote:usd"`
  const endpoint = `endpoint="test"`
  const transport = `transport_type="WebSocketTransport"`

  t.is(metricsMap.get(`ws_connection_active{${basic}}`), 1)
  t.is(metricsMap.get(`ws_subscription_active{${feed},${basic}}`), 1)
  t.is(metricsMap.get(`ws_subscription_total{${feed},${basic}}`), 1)
  t.is(metricsMap.get(`ws_message_total{${feed},direction="sent",${basic}}`), 1)
  t.is(metricsMap.get(`ws_message_total{direction="received",${basic}}`), 1)
  t.is(metricsMap.get(`bg_execute_total{${endpoint},${basic}}`), 2)
  t.is(metricsMap.get(`bg_execute_subscription_set_count{${endpoint},${transport},${basic}}`), 1)

  const responseTime = metricsMap.get(`bg_execute_duration_seconds{${endpoint},${basic}}`)
  if (responseTime !== undefined) {
    t.is(typeof responseTime === 'number', true)
    t.is(responseTime > 0, true)
  } else {
    t.fail('Response time did not record')
  }

  // Wait until the cache expires, and the subscription is out
  await clock.tickAsync(
    Math.ceil(CACHE_MAX_AGE / adapter.config.WS_SUBSCRIPTION_TTL) *
      adapter.config.WS_SUBSCRIPTION_TTL *
      2 +
      1,
  )

  // Now that the cache is out and the subscription no longer there, this should time out
  const error2: AxiosError | undefined = await t.throwsAsync(makeRequest)
  t.is(error2?.response?.status, 504)

  // Check connection, subscription active, subscription total, and message total metrics when unsubscribed from feed
  response = await axios.get(metricsAddress)
  metricsMap = parsePromMetrics(response.data)

  t.is(metricsMap.get(`ws_connection_active{${basic}}`), 1)
  t.is(metricsMap.get(`ws_subscription_active{${feed},${basic}}`), 0)
  t.is(metricsMap.get(`ws_subscription_total{${feed},${basic}}`), 1)
  t.is(metricsMap.get(`ws_message_total{${feed},direction="sent",${basic}}`), 2)
  t.is(metricsMap.get(`ws_message_total{direction="received",${basic}}`), 1)

  t.context.server.close()

  // Check connection metric after connection closed
  response = await axios.get(metricsAddress)
  metricsMap = parsePromMetrics(response.data)

  t.is(metricsMap.get(`ws_connection_active{${basic}}`), 0)
  t.is(metricsMap.get(`bg_execute_total{${endpoint},${basic}}`), 6)
  t.is(metricsMap.get(`bg_execute_subscription_set_count{${endpoint},${transport},${basic}}`), 0)
})
