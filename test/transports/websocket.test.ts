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
  process.env['METRICS_ENABLED'] = 'true'
  eaMetrics.clear()

  const labels = {
    feed_id: "{'base':'eth','quote':'doge'}",
    subscription_key: "test-{'base':'eth','quote':'doge'}",
  }

  // Mock WS
  mockWebSocketProvider(WebSocketClassProvider)
  const mockWsServer = new Server(ENDPOINT_URL, { mock: false })
  let connectionCounter = 0
  let messageCounter = 0

  mockWsServer.on('connection', (socket) => {
    connectionCounter++
    socket.on('message', () => {
      messageCounter++
      socket.send(
        JSON.stringify({
          pair: `${base}/${quote}`,
          value: price,
        }),
      )
    })
  })

  const adapter = createAdapter({
    WS_SUBSCRIPTION_TTL: 30000,
    WS_SUBSCRIPTION_UNRESPONSIVE_TTL,
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

  let metrics = await testAdapter.getMetrics()
  metrics.assert(t, { name: 'ws_subscription_active', labels, expectedValue: 1 })
  metrics.assert(t, { name: 'ws_subscription_total', labels, expectedValue: 1 })
  metrics.assert(t, {
    name: 'ws_message_total',
    labels: { ...labels, direction: 'sent' },
    expectedValue: 1,
  })

  // Advance to next cycle where connection is unhealthy and reconnect
  await runAllUntilTime(t.context.clock, BACKGROUND_EXECUTE_MS_WS + 100)

  // The connection was opened twice
  t.is(connectionCounter, 2)
  // The subscribe message was sent twice as well, since when we reopened we resubscribed to everything
  t.is(messageCounter, 2)

  // Only one active sub should be recorded
  metrics = await testAdapter.getMetrics()
  metrics.assert(t, { name: 'ws_subscription_active', labels, expectedValue: 1 })
  metrics.assert(t, { name: 'ws_subscription_total', labels, expectedValue: 2 })
  metrics.assert(t, {
    name: 'ws_message_total',
    labels: { ...labels, direction: 'sent' },
    expectedValue: 2,
  })

  process.env['METRICS_ENABLED'] = 'false'
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
    eaMetrics.clear()

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

  const heartBeatRounds = 2

  await runAllUntilTime(t.context.clock, HEARTBEAT_INTERVAL * heartBeatRounds)

  t.is(heartbeatCallCount, heartBeatRounds)

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

test.serial('does not heartbeat when handler throws an error', async (t) => {
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
      throw new Error('Heartbeat handler error')
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

  const heartBeatRounds = 2

  await runAllUntilTime(t.context.clock, HEARTBEAT_INTERVAL * heartBeatRounds)

  t.is(heartbeatCallCount, heartBeatRounds)

  testAdapter.api.close()
  mockWsServer.close()
  await t.context.clock.runToLastAsync()
})

// ---------------------------------------------------------------------------
// Tests demonstrating the connectionOpenedAt reset bug (1005 reconnect loop)
// ---------------------------------------------------------------------------

// Separate URL to avoid mock-socket "already listening" conflicts with
// preceding tests that may not fully close their mock servers.
const ENDPOINT_URL_1005 = 'wss://test-ws-1005.com/asd'

test.serial(
  'failover counter does not increment during rapid external close loop (1005 bug)',
  async (t) => {
    const base = 'ETH'
    const quote = 'DOGE'

    // TTL must be GREATER than BACKGROUND_EXECUTE_MS_WS (5s) so the
    // connectionOpenedAt reset keeps timeSinceConnectionOpened below the
    // threshold on every cycle, preventing connectionUnresponsive from
    // ever becoming true.
    const WS_SUBSCRIPTION_UNRESPONSIVE_TTL = 10_000

    mockWebSocketProvider(WebSocketClassProvider)
    const mockWsServer = new Server(ENDPOINT_URL_1005, { mock: false })
    let connectionCounter = 0
    const failoverCounterValues: number[] = []

    mockWsServer.on('connection', (socket) => {
      connectionCounter++
      // Simulate Tiingo dropping connection with 1005 shortly after open
      setTimeout(() => {
        socket.close({ code: 1005, reason: '', wasClean: false })
      }, 100)
    })

    const transport = new WebSocketTransport<WebSocketTypes>({
      url: (_context, _desiredSubs, urlConfigFunctionParameters) => {
        failoverCounterValues.push(
          urlConfigFunctionParameters.streamHandlerInvocationsWithNoConnection,
        )
        return ENDPOINT_URL_1005
      },
      handlers: {
        message(message) {
          if (!message.pair) return []
          const [b, q] = message.pair.split('/')
          return [
            {
              params: { base: b, quote: q },
              response: {
                data: { result: message.value },
                result: message.value,
                timestamps: { providerIndicatedTimeUnixMs: Date.now() },
              },
            },
          ]
        },
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
      transport,
      inputParameters,
    })

    const config = new AdapterConfig(
      {},
      {
        envDefaultOverrides: {
          BACKGROUND_EXECUTE_MS_WS,
          WS_SUBSCRIPTION_TTL: 60_000,
          WS_SUBSCRIPTION_UNRESPONSIVE_TTL,
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

    const error = await testAdapter.request({ base, quote })
    t.is(error.statusCode, 504)

    // Advance clock through multiple reconnect cycles
    await runAllUntilTime(t.context.clock, BACKGROUND_EXECUTE_MS_WS * 6)

    // Multiple reconnections should have occurred
    t.true(connectionCounter >= 3, `Expected at least 3 reconnects but got ${connectionCounter}`)

    // The failover counter should remain at 0 the entire time.
    // connectionOpenedAt resets on each reconnect, keeping
    // timeSinceConnectionOpened (~5s) below WS_SUBSCRIPTION_UNRESPONSIVE_TTL
    // (10s), so connectionUnresponsive is never true.
    t.is(transport.streamHandlerInvocationsWithNoConnection, 0)
    t.true(
      failoverCounterValues.every((v) => v === 0),
      `Every url() call should have received counter=0, got: [${failoverCounterValues}]`,
    )

    testAdapter.api.close()
    mockWsServer.close()
    await t.context.clock.runToLastAsync()
  },
)

test.serial(
  'failover counter increments for unresponsive-but-open connections (control test)',
  async (t) => {
    const base = 'ETH'
    const quote = 'DOGE'
    const WS_SUBSCRIPTION_UNRESPONSIVE_TTL = 10_000

    mockWebSocketProvider(WebSocketClassProvider)
    const mockWsServer = new Server(ENDPOINT_URL_1005, { mock: false })
    let connectionCounter = 0
    const failoverCounterValues: number[] = []

    // Server accepts connections but never sends data -- connection stays open
    mockWsServer.on('connection', (socket) => {
      connectionCounter++
      socket.on('message', () => {
        // Accept subscribe messages but don't send any data back
      })
    })

    const transport = new WebSocketTransport<WebSocketTypes>({
      url: (_context, _desiredSubs, urlConfigFunctionParameters) => {
        failoverCounterValues.push(
          urlConfigFunctionParameters.streamHandlerInvocationsWithNoConnection,
        )
        return ENDPOINT_URL_1005
      },
      handlers: {
        message(message) {
          if (!message.pair) return []
          const [b, q] = message.pair.split('/')
          return [
            {
              params: { base: b, quote: q },
              response: {
                data: { result: message.value },
                result: message.value,
                timestamps: { providerIndicatedTimeUnixMs: Date.now() },
              },
            },
          ]
        },
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
      transport,
      inputParameters,
    })

    const config = new AdapterConfig(
      {},
      {
        envDefaultOverrides: {
          BACKGROUND_EXECUTE_MS_WS,
          WS_SUBSCRIPTION_TTL: 60_000,
          WS_SUBSCRIPTION_UNRESPONSIVE_TTL,
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

    const error = await testAdapter.request({ base, quote })
    t.is(error.statusCode, 504)

    // Advance clock past WS_SUBSCRIPTION_UNRESPONSIVE_TTL so the open-but-
    // silent connection is detected as unresponsive. Need 3+ cycles (15s+)
    // because the check is strictly-greater-than (>) the TTL (10s).
    await runAllUntilTime(t.context.clock, BACKGROUND_EXECUTE_MS_WS * 4 + 500)

    // Connection was reopened after unresponsive detection
    t.true(connectionCounter >= 2, `Expected at least 2 connections but got ${connectionCounter}`)

    // The failover counter should have incremented (unlike the rapid-close bug)
    t.true(
      transport.streamHandlerInvocationsWithNoConnection > 0,
      `Expected failover counter > 0, got ${transport.streamHandlerInvocationsWithNoConnection}`,
    )
    t.true(
      failoverCounterValues.some((v) => v > 0),
      `Expected at least one url() call with counter > 0, got: [${failoverCounterValues}]`,
    )

    testAdapter.api.close()
    mockWsServer.close()
    await t.context.clock.runToLastAsync()
  },
)

test.serial(
  'EA stalls during rapid reconnect loop and never recovers to serve prices',
  async (t) => {
    const base = 'ETH'
    const quote = 'DOGE'
    const WS_SUBSCRIPTION_UNRESPONSIVE_TTL = 10_000

    mockWebSocketProvider(WebSocketClassProvider)
    const mockWsServer = new Server(ENDPOINT_URL_1005, { mock: false })
    let connectionCounter = 0
    let dropConnections = false

    mockWsServer.on('connection', (socket) => {
      connectionCounter++
      if (dropConnections) {
        setTimeout(() => {
          socket.close({ code: 1005, reason: '', wasClean: false })
        }, 100)
        return
      }

      // Normal operation: respond to subscribe messages with price data
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
      url: () => ENDPOINT_URL_1005,
      handlers: {
        message(message) {
          if (!message.pair) return []
          const [b, q] = message.pair.split('/')
          return [
            {
              params: { base: b, quote: q },
              response: {
                data: { result: message.value },
                result: message.value,
                timestamps: { providerIndicatedTimeUnixMs: Date.now() },
              },
            },
          ]
        },
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
      transport,
      inputParameters,
    })

    const config = new AdapterConfig(
      {},
      {
        envDefaultOverrides: {
          BACKGROUND_EXECUTE_MS_WS,
          WS_SUBSCRIPTION_TTL: 120_000,
          WS_SUBSCRIPTION_UNRESPONSIVE_TTL,
          CACHE_MAX_AGE: 5_000,
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

    // Phase 1: normal operation -- verify prices flow
    await testAdapter.startBackgroundExecuteThenGetResponse(t, {
      requestData: { base, quote },
      expectedResponse: {
        data: { result: price },
        result: price,
        statusCode: 200,
      },
    })
    t.is(connectionCounter, 1)

    // Phase 2: switch to dropping connections with 1005
    dropConnections = true
    mockWsServer.clients().forEach((client) => {
      client.close({ code: 1005, reason: '', wasClean: false })
    })

    // Advance clock past CACHE_MAX_AGE (5s) and through several reconnect
    // cycles so the cached price expires and the reconnect loop is visible.
    await runAllUntilTime(t.context.clock, BACKGROUND_EXECUTE_MS_WS * 8)

    // Multiple reconnection attempts should have occurred
    t.true(connectionCounter >= 3, `Expected at least 3 connections but got ${connectionCounter}`)

    // The EA should now be stalled: cached price has expired, no new data
    const staleResponse = await testAdapter.request({ base, quote })
    t.is(
      staleResponse.statusCode,
      504,
      'EA should return 504 because cache expired and no new prices are flowing',
    )

    // Failover counter should still be 0 -- EA is trapped on the same URL
    t.is(transport.streamHandlerInvocationsWithNoConnection, 0)

    testAdapter.api.close()
    mockWsServer.close()
    await t.context.clock.runToLastAsync()
  },
)
