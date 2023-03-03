import FakeTimers, { InstalledClock } from '@sinonjs/fake-timers'
import untypedTest, { TestFn } from 'ava'
import { Server, WebSocket } from 'mock-socket'
import { Adapter, AdapterEndpoint } from '../../src/adapter'
import { BaseAdapterSettings, AdapterConfig } from '../../src/config'
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
  Settings: BaseAdapterSettings
  Provider: {
    WsMessage: ProviderMessage
  }
}

const BACKGROUND_EXECUTE_MS_WS = 5000
const URL = 'wss://test-ws.com/asd'

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

const config = new AdapterConfig(
  {},
  {
    envDefaultOverrides: {
      CACHE_MAX_AGE,
      BACKGROUND_EXECUTE_MS_WS,
    },
  },
)

const adapter = new Adapter({
  name: 'TEST',
  defaultEndpoint: 'test',
  config,
  endpoints: [webSocketEndpoint],
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

test.serial('test WS connection, subscription, and message metrics', async (t) => {
  await t.context.testAdapter.startBackgroundExecuteThenGetResponse(t, {
    requestData: {
      base,
      quote,
    },
  })

  // Check connection, subscription active, subscription total, and message total metrics when subscribed to feed
  let metrics = await t.context.testAdapter.getMetrics()
  const feed_id = '{\\"base\\":\\"eth\\",\\"quote\\":\\"usd\\"}'
  const subscription_key = `test-${feed_id}`
  const adapter_endpoint = `test`
  const transport = 'default_single_transport'
  const transport_type = `WebSocketTransport`

  metrics.assert(t, {
    name: 'ws_connection_active',
    expectedValue: 1,
  })
  metrics.assert(t, {
    name: 'ws_subscription_active',
    labels: {
      feed_id,
      subscription_key,
    },
    expectedValue: 1,
  })
  metrics.assert(t, {
    name: 'ws_subscription_total',
    labels: {
      feed_id,
      subscription_key,
    },
    expectedValue: 1,
  })
  metrics.assert(t, {
    name: 'ws_message_total',
    labels: {
      feed_id,
      subscription_key,
      direction: 'sent',
    },
    expectedValue: 1,
  })
  metrics.assert(t, {
    name: 'ws_message_total',
    labels: { direction: 'received' },
    expectedValue: 1,
  })
  metrics.assert(t, {
    name: 'bg_execute_total',
    labels: { adapter_endpoint, transport },
    expectedValue: 2,
  })
  metrics.assert(t, {
    name: 'bg_execute_subscription_set_count',
    labels: { adapter_endpoint, transport_type },
    expectedValue: 1,
  })
  metrics.assertPositiveNumber(t, {
    name: 'bg_execute_duration_seconds',
    labels: { adapter_endpoint, transport },
  })

  // Wait until the cache expires, and the subscription is out
  await t.context.clock.tickAsync(
    Math.ceil(CACHE_MAX_AGE / adapter.config.settings.WS_SUBSCRIPTION_TTL) *
      adapter.config.settings.WS_SUBSCRIPTION_TTL *
      2 +
      1,
  )

  // Now that the cache is out and the subscription no longer there, this should time out
  const error2 = await t.context.testAdapter.request({ base, quote })
  t.is(error2?.statusCode, 504)

  // Check connection, subscription active, subscription total, and message total metrics when unsubscribed from feed
  metrics = await t.context.testAdapter.getMetrics()

  metrics.assert(t, {
    name: 'ws_connection_active',
    expectedValue: 1,
  })
  metrics.assert(t, {
    name: 'ws_subscription_active',
    labels: { feed_id, subscription_key },
    expectedValue: 0,
  })
  metrics.assert(t, {
    name: 'ws_subscription_total',
    labels: { feed_id, subscription_key },
    expectedValue: 1,
  })
  metrics.assert(t, {
    name: 'ws_message_total',
    labels: { feed_id, subscription_key, direction: 'sent' },
    expectedValue: 2,
  })
  metrics.assert(t, {
    name: 'ws_message_total',
    labels: { direction: 'received' },
    expectedValue: 1,
  })

  t.context.server.close()

  // Check connection metric after connection closed
  metrics = await t.context.testAdapter.getMetrics()

  metrics.assert(t, {
    name: 'ws_connection_active',
    expectedValue: 0,
  })
  metrics.assert(t, {
    name: 'bg_execute_total',
    labels: { adapter_endpoint, transport },
    expectedValue: 5,
  })
  metrics.assert(t, {
    name: 'bg_execute_subscription_set_count',
    labels: { adapter_endpoint, transport_type },
    expectedValue: 0,
  })
})
