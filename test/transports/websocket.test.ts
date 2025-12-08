import { InstalledClock } from '@sinonjs/fake-timers'
import { installTimers } from '../helper'
import untypedTest, { TestFn } from 'ava'
import { Server } from 'mock-socket'
import WebSocket from 'ws'
import { Adapter, AdapterEndpoint, EndpointContext } from '../../src/adapter'
import { AdapterConfig, EmptyCustomSettings } from '../../src/config'
import { metrics as eaMetrics } from '../../src/metrics'
import {
  WebSocketClassProvider,
  WebsocketReverseMappingTransport,
  WebSocketTransport,
} from '../../src/transports'
import { SingleNumberResultResponse, sleep } from '../../src/util'
import { mockWebSocketProvider, runAllUntilTime, TestAdapter } from '../../src/util/testing-utils'
import { InputParameters } from '../../src/validation'

export const test = untypedTest as TestFn<{
  testAdapter: TestAdapter
  clock: InstalledClock
}>

export const inputParameters = new InputParameters({
  base: {
    type: 'string',
    description: 'base',
    required: true,
  },
  quote: {
    type: 'string',
    description: 'quote',
    required: true,
  },
})

interface ProviderMessage {
  pair: string
  value: number
}

const ENDPOINT_URL = 'wss://test-ws.com/asd'

const CACHE_MAX_AGE = 1000

// Disable retries to make the testing flow easier
process.env['CACHE_POLLING_MAX_RETRIES'] = '0'

const price = 251324

type WebSocketTypes = {
  Parameters: typeof inputParameters.definition
  Response: SingleNumberResultResponse
  Settings: EmptyCustomSettings
  Provider: {
    WsMessage: ProviderMessage
  }
}

const BACKGROUND_EXECUTE_MS_WS = 5000

const createAdapter = (
  envDefaultOverrides: Record<string, string | number | symbol>,
  heartbeatHandler?: (
    connection: WebSocket,
    context: EndpointContext<WebSocketTypes>,
  ) => Promise<void> | void,
): Adapter => {
  const websocketTransport = new WebSocketTransport<WebSocketTypes>({
    url: () => ENDPOINT_URL,
    options: () => {
      return {
        headers: {
          'x-auth-token': 'token',
        },
      }
    },
    handlers: {
      message(message) {
        if (!message.pair) {
          return []
        }
        const [base, quote] = message.pair.split('/')
        return [
          {
            params: { base, quote },
            response: {
              data: {
                result: message.value,
              },
              result: message.value,
              timestamps: {
                providerIndicatedTimeUnixMs: Date.now(),
              },
            },
          },
        ]
      },
      heartbeat: heartbeatHandler,
    },
    builders: {
      subscribeMessage: (params) => `S:${params.base}/${params.quote}`,
      unsubscribeMessage: (params) => ({
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

test.before((t) => {
  t.context.clock = installTimers()
})

test.afterEach((t) => {
  t.context.clock.reset()
})

test.serial('connects to websocket, subscribes, gets message, unsubscribes', async (t) => {
  const base = 'ETH'
  const quote = 'DOGE'

  // Mock WS
  mockWebSocketProvider(WebSocketClassProvider)
  const mockWsServer = new Server(ENDPOINT_URL, { mock: false })
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
  const mockWsServer = new Server(ENDPOINT_URL, { mock: false })
  let connectionCounter = 0
  mockWsServer.on('connection', async (socket) => {
    const url = new URL(socket.url)
    const base = url.searchParams.get('test')?.split(',').at(-1)

    await sleep(100)
    connectionCounter++

    socket.send(
      JSON.stringify({
        pair: `${base}/USD`,
        value: price,
      }),
    )
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
  const mockWsServer = new Server(ENDPOINT_URL, { mock: false })
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

test.serial('reconnects if provider stops sending expected messages', async (t) => {
  const base = 'ETH'
  const quote = 'DOGE'
  const WS_SUBSCRIPTION_UNRESPONSIVE_TTL = 1000

  // Mock WS
  mockWebSocketProvider(WebSocketClassProvider)
  const mockWsServer = new Server(ENDPOINT_URL, { mock: false })
  let connectionCounter = 0

  mockWsServer.on('connection', (socket) => {
    let counter = 0
    const parseMessage = () => {
      if (counter++ === 0) {
        socket.send(JSON.stringify({ error: '' }))
      }
    }
    connectionCounter++
    socket.on('message', parseMessage)
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

  // The WS connection sends messages that are not stored in the cache, so we advance the clock until
  // we reach the point where the EA will consider it unhealthy and reconnect.
  await runAllUntilTime(t.context.clock, BACKGROUND_EXECUTE_MS_WS * 2 + 100)

  // The connection was opened twice
  t.is(connectionCounter, 2)

  testAdapter.api.close()
  mockWsServer.close()
  await t.context.clock.runToLastAsync()
})

test.serial('resubscribes after reconnection if server closes connection', async (t) => {
  const base = 'ETH'
  const quote = 'DOGE'

  // Mock WS
  mockWebSocketProvider(WebSocketClassProvider)
  const mockWsServer = new Server(ENDPOINT_URL, { mock: false })
  let connectionCounter = 0
  let messageCounter = 0

  mockWsServer.on('connection', (socket) => {
    connectionCounter++
    socket.on('message', () => {
      messageCounter++
      if (messageCounter === 1) {
        socket.close()
      }
    })
  })

  const adapter = createAdapter({
    WS_SUBSCRIPTION_TTL: 30000,
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
    const mockWsServer = new Server(ENDPOINT_URL, { mock: false })
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
      url: () => ENDPOINT_URL,
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
        subscribeMessage: (params) => ({
          request: 'subscribe',
          pair: `${params.base}/${params.quote}`,
        }),
        unsubscribeMessage: (params) => ({
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
      name: 'stream_handler_errors',
      labels: {
        adapter_endpoint: 'test',
        transport: 'default_single_transport',
      },
      expectedValue: 1,
    })

    process.env['METRICS_ENABLED'] = 'false'
    await testAdapter.api.close()
    mockWsServer.close()
    await t.context.clock.runToLastAsync()
  },
)

test.serial('does not crash the server when new connection errors', async (t) => {
  const base = 'ETH'
  const quote = 'DOGE'
  process.env['METRICS_ENABLED'] = 'true'
  eaMetrics.clear()

  // Mock WS
  mockWebSocketProvider(WebSocketClassProvider)
  const mockWsServer = new Server(ENDPOINT_URL, { mock: false })
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
    // Changing the url so that the connection will error on initial request
    url: () => `${ENDPOINT_URL}test`,
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
      subscribeMessage: (params) => ({
        request: 'subscribe',
        pair: `${params.base}/${params.quote}`,
      }),
      unsubscribeMessage: (params) => ({
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

  const error = await testAdapter.request({
    base,
    quote,
  })
  t.is(error.statusCode, 504)

  await runAllUntilTime(t.context.clock, BACKGROUND_EXECUTE_MS_WS * 2 + 100)

  const metrics = await testAdapter.getMetrics()
  metrics.assert(t, {
    name: 'ws_connection_errors',
    labels: {
      message: 'undefined',
    },
    expectedValue: 1,
  })

  process.env['METRICS_ENABLED'] = 'false'
  t.pass()
  await testAdapter.api.close()
  mockWsServer.close()
  await t.context.clock.runToLastAsync()
})

test.serial('closed ws connection should have a 1000 status code', async (t) => {
  const base = 'ETH'
  const quote = 'DOGE'
  const WS_SUBSCRIPTION_UNRESPONSIVE_TTL = 1000
  process.env['METRICS_ENABLED'] = 'true'
  eaMetrics.clear()

  // Mock WS
  mockWebSocketProvider(WebSocketClassProvider)
  const mockWsServer = new Server(ENDPOINT_URL, { mock: false })

  const adapter = createAdapter({
    WS_SUBSCRIPTION_TTL: 30000,
    WS_SUBSCRIPTION_UNRESPONSIVE_TTL,
  })

  const testAdapter = await TestAdapter.startWithMockedCache(adapter, t.context)

  await testAdapter.request({
    base,
    quote,
  })

  // The WS connection should not send any messages to the EA, so we advance the clock until
  // we reach the point where the EA will consider it unhealthy and reconnect.
  await runAllUntilTime(t.context.clock, BACKGROUND_EXECUTE_MS_WS * 2 + 100)

  const metrics = await testAdapter.getMetrics()

  metrics.assert(t, {
    name: 'ws_connection_closures',
    labels: { code: '1000', url: 'wss://test-ws.com/asd' },
    expectedValue: 1,
  })

  testAdapter.api.close()
  mockWsServer.close()
  await t.context.clock.runToLastAsync()
})

test.serial('does not hang the background execution if the open handler hangs', async (t) => {
  const base = 'ETH'
  const quote = 'DOGE'
  process.env['METRICS_ENABLED'] = 'true'
  eaMetrics.clear()

  // Mock WS
  mockWebSocketProvider(WebSocketClassProvider)
  const mockWsServer = new Server(ENDPOINT_URL, { mock: false })
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
    url: () => ENDPOINT_URL,
    handlers: {
      async open() {
        return new Promise((res) => {
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
      subscribeMessage: (params) => ({
        request: 'subscribe',
        pair: `${params.base}/${params.quote}`,
      }),
      unsubscribeMessage: (params) => ({
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
    name: 'stream_handler_errors',
    labels: {
      adapter_endpoint: 'test',
      transport: 'default_single_transport',
    },
    expectedValue: 1,
  })

  process.env['METRICS_ENABLED'] = 'false'
  await testAdapter.api.close()
  mockWsServer.close()
  await t.context.clock.runToLastAsync()
})

test.serial('if defined the close handler is called when the websocket is closed', async (t) => {
  const base = 'ETH'
  const quote = 'DOGE'
  process.env['METRICS_ENABLED'] = 'false'
  let handlerCalled = false

  // Mock WS
  mockWebSocketProvider(WebSocketClassProvider)
  const mockWsServer = new Server(ENDPOINT_URL, { mock: false })
  mockWsServer.on('connection', (socket) => {
    socket.on('message', () => {
      socket.send(
        JSON.stringify({
          pair: `${base}/${quote}`,
          value: price,
        }),
      )
    })
    socket.close()
  })

  const transport = new WebSocketTransport<WebSocketTypes>({
    url: () => ENDPOINT_URL,
    handlers: {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      close: (event) => {
        handlerCalled = true
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
      subscribeMessage: (params) => ({
        request: 'subscribe',
        pair: `${params.base}/${params.quote}`,
      }),
      unsubscribeMessage: (params) => ({
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

  await testAdapter.api.close()
  mockWsServer.close()
  await t.context.clock.runToLastAsync()

  t.true(handlerCalled)
})

test.serial(
  'if defined the error handler is called when the websocket emits an error',
  async (t) => {
    const base = 'ETH'
    const quote = 'DOGE'
    process.env['METRICS_ENABLED'] = 'false'
    let handlerCalled = false

    // Mock WS
    mockWebSocketProvider(WebSocketClassProvider)
    const mockWsServer = new Server(ENDPOINT_URL, { mock: false })
    mockWsServer.on('connection', (socket) => {
      socket.on('message', () => {
        socket.send(
          JSON.stringify({
            pair: `${base}/${quote}`,
            value: price,
          }),
        )
      })
      // Simulate error event after connection
      setTimeout(() => {
        const errorEvent = new Event('error')
        socket.dispatchEvent(errorEvent)
      }, 100)
    })

    const transport = new WebSocketTransport<WebSocketTypes>({
      url: () => ENDPOINT_URL,
      handlers: {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        error: (event) => {
          handlerCalled = true
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
        subscribeMessage: (params) => ({
          request: 'subscribe',
          pair: `${params.base}/${params.quote}`,
        }),
        unsubscribeMessage: (params) => ({
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

    await testAdapter.api.close()
    mockWsServer.close()
    await t.context.clock.runToLastAsync()

    t.true(handlerCalled)
  },
)

const createReverseMappingAdapter = (
  envDefaultOverrides?: Record<string, string | number | symbol>,
): Adapter => {
  const websocketTransport: WebsocketReverseMappingTransport<WebSocketTypes, string> =
    new WebsocketReverseMappingTransport<WebSocketTypes, string>({
      url: () => ENDPOINT_URL,
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
        subscribeMessage: (params) => {
          const pair = `${params.base}/${params.quote}`
          websocketTransport.setReverseMapping(pair, params)
          return {
            request: 'subscribe',
            pair,
          }
        },
        unsubscribeMessage: (params) => ({
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
  const mockWsServer = new Server(ENDPOINT_URL, { mock: false })
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

  testAdapter.api.close()
  mockWsServer.close()
  await t.context.clock.runToLastAsync()
})

test.serial('sends heartbeat using ping at configured interval', async (t) => {
  const base = 'ETH'
  const quote = 'DOGE'
  const HEARTBEAT_INTERVAL = 5000

  // Mock WS
  mockWebSocketProvider(WebSocketClassProvider)
  const mockWsServer = new Server(ENDPOINT_URL, { mock: false })
  let heartbeatCallCount = 0

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

  const adapter = createAdapter(
    {
      WS_HEARTBEAT_INTERVAL_MS: HEARTBEAT_INTERVAL,
    },
    () => {
      heartbeatCallCount++
    },
  )

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

  await runAllUntilTime(t.context.clock, HEARTBEAT_INTERVAL)

  t.true(heartbeatCallCount >= 1, `Expected at least 1 heartbeat call, got ${heartbeatCallCount}`)

  testAdapter.api.close()
  mockWsServer.close()
  await t.context.clock.runToLastAsync()
})

test.serial('stops heartbeat when connection closes', async (t) => {
  const base = 'ETH'
  const quote = 'DOGE'
  const HEARTBEAT_INTERVAL = 5000
  // Mock WS
  mockWebSocketProvider(WebSocketClassProvider)
  const mockWsServer = new Server(ENDPOINT_URL, { mock: false })
  let heartbeatCallCount = 0

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

  const adapter = createAdapter(
    {
      WS_HEARTBEAT_INTERVAL_MS: HEARTBEAT_INTERVAL,
    },
    () => {
      heartbeatCallCount++
    },
  )

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

  const heartbeatCountBeforeClose = heartbeatCallCount

  testAdapter.api.close()
  mockWsServer.close()

  await runAllUntilTime(t.context.clock, HEARTBEAT_INTERVAL * 2)

  t.is(heartbeatCallCount, heartbeatCountBeforeClose)

  await t.context.clock.runToLastAsync()
})

test.serial('stops heartbeat when handler throws an error', async (t) => {
  const base = 'ETH'
  const quote = 'DOGE'
  const HEARTBEAT_INTERVAL = 5000
  // Mock WS
  mockWebSocketProvider(WebSocketClassProvider)
  const mockWsServer = new Server(ENDPOINT_URL, { mock: false })
  let heartbeatCallCount = 0

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

  const adapter = createAdapter(
    {
      WS_HEARTBEAT_INTERVAL_MS: HEARTBEAT_INTERVAL,
    },
    () => {
      heartbeatCallCount++
      if (heartbeatCallCount === 1) {
        throw new Error('Heartbeat handler error')
      }
    },
  )

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

  await runAllUntilTime(t.context.clock, HEARTBEAT_INTERVAL * 2)

  t.is(heartbeatCallCount, 1)

  testAdapter.api.close()
  mockWsServer.close()
  await t.context.clock.runToLastAsync()
})
