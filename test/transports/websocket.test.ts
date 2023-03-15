import FakeTimers, { InstalledClock } from '@sinonjs/fake-timers'
import untypedTest, { TestFn } from 'ava'
import { Server } from 'mock-socket'
import { Adapter, AdapterEndpoint } from '../../src/adapter'
import { AdapterConfig, BaseAdapterSettings } from '../../src/config'
import { metrics as eaMetrics } from '../../src/metrics'
import {
  WebSocketClassProvider,
  WebsocketReverseMappingTransport,
  WebSocketTransport,
} from '../../src/transports'
import { SingleNumberResultResponse } from '../../src/util'
import { InputParameters } from '../../src/validation'
import { mockWebSocketProvider, runAllUntilTime, TestAdapter } from '../util'

interface AdapterRequestParams {
  base: string
  quote: string
}

export const test = untypedTest as TestFn<{
  testAdapter: TestAdapter
  clock: InstalledClock
}>

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

const URL = 'wss://test-ws.com/asd'

const CACHE_MAX_AGE = 1000

// Disable retries to make the testing flow easier
process.env['CACHE_POLLING_MAX_RETRIES'] = '0'

const price = 251324

type WebSocketTypes = {
  Request: {
    Params: AdapterRequestParams
  }
  Response: SingleNumberResultResponse
  Settings: BaseAdapterSettings
  Provider: {
    WsMessage: ProviderMessage
  }
}

const BACKGROUND_EXECUTE_MS_WS = 5000

const createAdapter = (envDefaultOverrides: Record<string, string | number | symbol>): Adapter => {
  const websocketTransport = new WebSocketTransport<WebSocketTypes>({
    url: () => URL,
    handlers: {
      message(message) {
        const [base, quote] = message.pair.split('/')
        return [
          {
            params: { base, quote },
            response: {
              data: {
                result: message.value,
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

  const webSocketEndpoint = new AdapterEndpoint({
    name: 'TEST',
    transport: websocketTransport,
    inputParameters,
  })

  const config = new AdapterConfig(
    {},
    {
      envDefaultOverrides: {
        BACKGROUND_EXECUTE_MS_WS,
        ...envDefaultOverrides,
      },
    },
  )

  const adapter = new Adapter({
    name: 'TEST',
    defaultEndpoint: 'test',
    endpoints: [webSocketEndpoint],
    config,
  })

  return adapter
}

test.beforeEach((t) => {
  t.context.clock = FakeTimers.install()
})

test.afterEach((t) => {
  t.context.clock.uninstall()
})

test.serial('connects to websocket, subscribes, gets message, unsubscribes', async (t) => {
  const base = 'ETH'
  const quote = 'DOGE'

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

  const adapter = createAdapter({
    WS_SUBSCRIPTION_UNRESPONSIVE_TTL: 180_000,
  })

  const testAdapter = await TestAdapter.startWithMockedCache(adapter, t.context)

  await testAdapter.startBackgroundExecuteThenGetResponse(t, {
    requestData: { base, quote },
    expectedResponse: {
      data: {
        result: price,
      },
      result: price,
      statusCode: 200,
    },
  })

  // Wait until the cache expires, and the subscription is out
  const duration =
    Math.ceil(CACHE_MAX_AGE / adapter.config.settings.WS_SUBSCRIPTION_TTL) *
      adapter.config.settings.WS_SUBSCRIPTION_TTL +
    1
  await runAllUntilTime(t.context.clock, duration)

  // Now that the cache is out and the subscription no longer there, this should time out
  const error2 = await testAdapter.request({
    base,
    quote,
  })
  t.is(error2.statusCode, 504)

  testAdapter.api.close()
  mockWsServer.close()
  await t.context.clock.runToLastAsync()
})

test.serial('reconnects when url changed', async (t) => {
  // Mock WS
  mockWebSocketProvider(WebSocketClassProvider)
  const mockWsServer = new Server(URL, { mock: false })
  let connectionCounter = 0
  mockWsServer.on('connection', (socket) => {
    connectionCounter++

    const parseMessage = (message: any) => {
      const parsed = JSON.parse(message)
      socket.send(
        JSON.stringify({
          pair: parsed.pair,
          value: price,
        }),
      )
    }
    socket.on('message', (message) => {
      parseMessage(message)
    })
  })

  const transport = new WebSocketTransport<WebSocketTypes>({
    url: (context, desiredSubs) => {
      const gen = `wss://test-ws.com/asd?test=${desiredSubs.map((sub) => sub.base).join(',')}`
      return gen
    },
    handlers: {
      message(message) {
        const [curBase, curQuote] = message.pair.split('/')
        return [
          {
            params: { base: curBase, quote: curQuote },
            response: {
              data: {
                result: message.value,
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

  const webSocketEndpoint = new AdapterEndpoint({
    name: 'TEST',
    transport: transport,
    inputParameters,
  })

  const config = new AdapterConfig(
    {},
    {
      envDefaultOverrides: {
        WS_SUBSCRIPTION_TTL: 20000,
      },
    },
  )

  const adapter = new Adapter({
    name: 'TEST',
    defaultEndpoint: 'test',
    config,
    endpoints: [webSocketEndpoint],
  })

  const testAdapter = await TestAdapter.startWithMockedCache(adapter, t.context)

  const testResponse = async (base: string, count: number) => {
    await testAdapter.startBackgroundExecuteThenGetResponse(t, {
      requestData: { base, quote: 'USD' },
      expectedCacheSize: count,
      expectedResponse: {
        data: {
          result: price,
        },
        result: price,
        statusCode: 200,
      },
    })
    t.is(connectionCounter, count)
  }

  await testResponse('BTC', 1)
  await testResponse('ETH', 2)
  await testResponse('MATIC', 3)

  testAdapter.api.close()
  mockWsServer.close()
  await t.context.clock.runToLastAsync()
})

test.serial('reconnects if connection becomes unresponsive', async (t) => {
  const base = 'ETH'
  const quote = 'DOGE'
  const WS_SUBSCRIPTION_UNRESPONSIVE_TTL = 1000

  // Mock WS
  mockWebSocketProvider(WebSocketClassProvider)
  const mockWsServer = new Server(URL, { mock: false })
  let connectionCounter = 0
  let messageCounter = 0

  mockWsServer.on('connection', (socket) => {
    connectionCounter++
    socket.on('message', () => {
      messageCounter++
    })
  })

  const adapter = createAdapter({
    WS_SUBSCRIPTION_TTL: 30000,
    WS_SUBSCRIPTION_UNRESPONSIVE_TTL,
  })

  const testAdapter = await TestAdapter.startWithMockedCache(adapter, t.context)

  const error = await testAdapter.request({
    base,
    quote,
  })
  t.is(error.statusCode, 504)

  // The WS connection should not send any messages to the EA, so we advance the clock until
  // we reach the point where the EA will consider it unhealthy and reconnect.
  await runAllUntilTime(t.context.clock, BACKGROUND_EXECUTE_MS_WS * 2 + 100)

  // The connection was opened twice
  t.is(connectionCounter, 2)
  // The subscribe message was sent twice as well, since when we reopened we resubscribed to everything
  t.is(messageCounter, 2)

  testAdapter.api.close()
  mockWsServer.close()
  await t.context.clock.runToLastAsync()
})

test.serial(
  'does not crash the server when open handler rejects with error or throws',
  async (t) => {
    const base = 'ETH'
    const quote = 'DOGE'
    process.env['METRICS_ENABLED'] = 'true'

    let execution = 0

    // Mock WS
    mockWebSocketProvider(WebSocketClassProvider)
    const mockWsServer = new Server(URL, { mock: false })
    mockWsServer.on('connection', (socket) => {
      socket.on('message', () => {
        socket.send(
          JSON.stringify({
            pair: `${base}/${quote}`,
            value: price,
          }),
        )
      })
    })

    const transport = new WebSocketTransport<WebSocketTypes>({
      url: () => URL,
      handlers: {
        async open() {
          return new Promise((res, rej) => {
            if (execution === 0) {
              execution++
              setTimeout(res, 15_000)
            } else {
              res()
            }
            rej(new Error('Error from open handler'))
          })
        },

        message(message) {
          const [curBase, curQuote] = message.pair.split('/')
          return [
            {
              params: { base: curBase, quote: curQuote },
              response: {
                data: {
                  result: message.value,
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

    const webSocketEndpoint = new AdapterEndpoint({
      name: 'TEST',
      transport: transport,
      inputParameters,
    })

    const config = new AdapterConfig(
      {},
      {
        envDefaultOverrides: {
          BACKGROUND_EXECUTE_MS_WS,
          WS_SUBSCRIPTION_UNRESPONSIVE_TTL: 180_000,
        },
      },
    )

    const adapter = new Adapter({
      name: 'TEST',
      defaultEndpoint: 'test',
      config,
      endpoints: [webSocketEndpoint],
    })

    const testAdapter = await TestAdapter.startWithMockedCache(adapter, t.context)

    await testAdapter.startBackgroundExecuteThenGetResponse(t, {
      requestData: { base, quote },
      expectedResponse: {
        data: {
          result: price,
        },
        result: price,
        statusCode: 200,
      },
    })

    const metrics = await testAdapter.getMetrics()
    metrics.assert(t, {
      name: 'bg_execute_errors',
      labels: {
        adapter_endpoint: 'test',
        transport: 'default_single_transport',
      },
      expectedValue: 1,
    })

    process.env['METRICS_ENABLED'] = 'false'
    await testAdapter.api.close()
    mockWsServer.close()
    await t.context.clock.runAllAsync()
  },
)

test.serial('does not hang the background execution if the open handler hangs', async (t) => {
  const base = 'ETH'
  const quote = 'DOGE'
  process.env['METRICS_ENABLED'] = 'true'
  eaMetrics.clear()

  // Mock WS
  mockWebSocketProvider(WebSocketClassProvider)
  const mockWsServer = new Server(URL, { mock: false })
  mockWsServer.on('connection', (socket) => {
    socket.on('message', () => {
      socket.send(
        JSON.stringify({
          pair: `${base}/${quote}`,
          value: price,
        }),
      )
    })
  })

  let execution = 0

  const transport = new WebSocketTransport<WebSocketTypes>({
    url: () => URL,
    handlers: {
      async open() {
        return new Promise((res, rej) => {
          if (execution === 0) {
            execution++
            setTimeout(res, 15_000)
          } else {
            res()
          }
        })
      },

      message(message) {
        const [curBase, curQuote] = message.pair.split('/')
        return [
          {
            params: { base: curBase, quote: curQuote },
            response: {
              data: {
                result: message.value,
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

  const webSocketEndpoint = new AdapterEndpoint({
    name: 'TEST',
    transport: transport,
    inputParameters,
  })

  const config = new AdapterConfig(
    {},
    {
      envDefaultOverrides: {
        BACKGROUND_EXECUTE_MS_WS,
        WS_SUBSCRIPTION_UNRESPONSIVE_TTL: 180_000,
        WS_SUBSCRIPTION_TTL: 999_999,
      },
    },
  )

  const adapter = new Adapter({
    name: 'TEST',
    defaultEndpoint: 'test',
    config,
    endpoints: [webSocketEndpoint],
  })

  const testAdapter = await TestAdapter.startWithMockedCache(adapter, t.context)

  await testAdapter.startBackgroundExecuteThenGetResponse(t, {
    requestData: { base, quote },
    expectedResponse: {
      data: {
        result: price,
      },
      result: price,
      statusCode: 200,
    },
  })

  const metrics = await testAdapter.getMetrics()
  metrics.assert(t, {
    name: 'bg_execute_errors',
    labels: {
      adapter_endpoint: 'test',
      transport: 'default_single_transport',
    },
    expectedValue: 1,
  })

  process.env['METRICS_ENABLED'] = 'false'
  await testAdapter.api.close()
  mockWsServer.close()
  await t.context.clock.runAllAsync()
})

const createReverseMappingAdapter = (
  envDefaultOverrides?: Record<string, string | number | symbol>,
): Adapter => {
  const websocketTransport: WebsocketReverseMappingTransport<WebSocketTypes, string> =
    new WebsocketReverseMappingTransport<WebSocketTypes, string>({
      url: () => URL,
      handlers: {
        message(message) {
          const params = websocketTransport.getReverseMapping(message.pair)
          if (!params) {
            return undefined
          }

          return [
            {
              params,
              response: {
                data: {
                  result: message.value,
                },
                result: message.value,
              },
            },
          ]
        },
      },
      builders: {
        subscribeMessage: (params: AdapterRequestParams) => {
          const pair = `${params.base}/${params.quote}`
          websocketTransport.setReverseMapping(pair, params)
          return {
            request: 'subscribe',
            pair,
          }
        },
        unsubscribeMessage: (params: AdapterRequestParams) => ({
          request: 'unsubscribe',
          pair: `${params.base}/${params.quote}`,
        }),
      },
    })

  const webSocketEndpoint = new AdapterEndpoint({
    name: 'TEST',
    transport: websocketTransport,
    inputParameters,
  })

  const config = new AdapterConfig(
    {},
    {
      envDefaultOverrides: {
        BACKGROUND_EXECUTE_MS_WS,
        ...envDefaultOverrides,
      },
    },
  )

  const adapter = new Adapter({
    name: 'TEST',
    defaultEndpoint: 'test',
    config,
    endpoints: [webSocketEndpoint],
  })

  return adapter
}

test.serial('can set reverse mapping and read from it', async (t) => {
  const base = 'ETH'
  const quote = 'DOGE'

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

  const adapter = createReverseMappingAdapter({
    WS_SUBSCRIPTION_UNRESPONSIVE_TTL: 180_000,
  })

  const testAdapter = await TestAdapter.startWithMockedCache(adapter, t.context)
  await testAdapter.startBackgroundExecuteThenGetResponse(t, {
    requestData: { base, quote },
    expectedResponse: {
      data: {
        result: price,
      },
      result: price,
      statusCode: 200,
    },
  })
})
