import FakeTimers, { InstalledClock } from '@sinonjs/fake-timers'
import untypedTest, { TestFn } from 'ava'
import { Server, WebSocket } from 'mock-socket'
import { Adapter, AdapterEndpoint } from '../../src/adapter'
import { SettingsMap } from '../../src/config'
import { WebSocketClassProvider, WebSocketTransport } from '../../src/transports'
import { InputParameters } from '../../src/validation'
import { TestAdapter } from '../util'

export const test = untypedTest as TestFn<{
  adapterEndpoint: AdapterEndpoint<WebSocketEndpointTypes>
  testAdapter: TestAdapter
  server: Server
  clock: InstalledClock
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

const CACHE_MAX_AGE = 10000

process.env['METRICS_ENABLED'] = 'true'
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

  t.context.clock = FakeTimers.install()
  t.context.testAdapter = await TestAdapter.startWithMockedCache(adapter, t.context)
  t.context.server = mockWsServer
})

test.after(async (t) => {
  t.context.clock.uninstall()
})

test.serial('Test WS connection, subscription, and message metrics', async (t) => {
  await t.context.testAdapter.startBackgroundExecuteThenGetResponse(t, {
    requestData: {
      base,
      quote,
    },
  })

  // Check connection, subscription active, subscription total, and message total metrics when subscribed to feed
  const metricsMap = await t.context.testAdapter.getMetrics()

  const basic = `app_name="TEST",app_version="${version}"`
  const feed = `feed_id="{\\"base\\":\\"eth\\",\\"quote\\":\\"usd\\"}",subscription_key="test-{\\"base\\":\\"eth\\",\\"quote\\":\\"usd\\"}"`
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
  await t.context.clock.tickAsync(
    Math.ceil(CACHE_MAX_AGE / adapter.config.WS_SUBSCRIPTION_TTL) *
      adapter.config.WS_SUBSCRIPTION_TTL *
      2 +
      1,
  )

  // Now that the cache is out and the subscription no longer there, this should time out
  const error2 = await t.context.testAdapter.request({ base, quote })
  t.is(error2?.statusCode, 504)

  // Check connection, subscription active, subscription total, and message total metrics when unsubscribed from feed
  const metricsMap2 = await t.context.testAdapter.getMetrics()

  t.is(metricsMap2.get(`ws_connection_active{${basic}}`), 1)
  t.is(metricsMap2.get(`ws_subscription_active{${feed},${basic}}`), 0)
  t.is(metricsMap2.get(`ws_subscription_total{${feed},${basic}}`), 1)
  t.is(metricsMap2.get(`ws_message_total{${feed},direction="sent",${basic}}`), 2)
  t.is(metricsMap2.get(`ws_message_total{direction="received",${basic}}`), 1)

  t.context.server.close()

  // Check connection metric after connection closed
  const metricsMap3 = await t.context.testAdapter.getMetrics()

  t.is(metricsMap3.get(`ws_connection_active{${basic}}`), 0)
  t.is(metricsMap3.get(`bg_execute_total{${endpoint},${basic}}`), 5)
  t.is(metricsMap3.get(`bg_execute_subscription_set_count{${endpoint},${transport},${basic}}`), 0)
})
