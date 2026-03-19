/* eslint-disable max-nested-callbacks */
import FakeTimers, { InstalledClock } from '@sinonjs/fake-timers'
import untypedTest, { TestFn } from 'ava'
import { Server } from 'mock-socket'
import { Adapter, AdapterEndpoint } from '../../src/adapter'
import { AdapterConfig, EmptyCustomSettings } from '../../src/config'
import { metrics as eaMetrics } from '../../src/metrics'
import {
  WebSocketClassProvider,
  WebSocketTransport,
  WebsocketReverseMappingTransport,
} from '../../src/transports'
import { SingleNumberResultResponse, sleep } from '../../src/util'
import { TestAdapter, mockWebSocketProvider, runAllUntilTime } from '../../src/util/testing-utils'
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

const createAdapter = (envDefaultOverrides: Record<string, string | number | symbol>): Adapter => {
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

let activeClock: InstalledClock | null = null

test.beforeEach((t) => {
  activeClock?.uninstall()
  t.context.clock = FakeTimers.install()
  activeClock = t.context.clock
})

test.afterEach((t) => {
  t.context.clock.uninstall()
  activeClock = null
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
  await t.context.clock.runAllAsync()
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

test.serial(
  'does not unnecessarily unsubscribe when two requests differ only in casing for the same pair',
  async (t) => {
    // Regression test for the case-sensitivity mismatch between the subscription set
    // (keyed by lowercased cache key) and StreamingTransport's local subscription diff
    // (which uses JSON.stringify, preserving original casing).
    //
    // Scenario:
    //   1. Request A { base: 'USDe', quote: 'USD' } → subscribes; localSubscriptions=['USDe/USD']
    //   2. Request B { base: 'usde', quote: 'usd' } → same cache key, hits cache,
    //      but overwrites the subscription-set value with the lowercase variant
    //   3. Next background execute: desiredSubs=['usde/usd'] vs localSubscriptions=['USDe/USD']
    //      → JSON.stringify mismatch → unnecessary unsubscribe + resubscribe

    mockWebSocketProvider(WebSocketClassProvider)
    const mockWsServer = new Server(ENDPOINT_URL, { mock: false })
    let subscribeCount = 0
    let unsubscribeCount = 0

    mockWsServer.on('connection', (socket) => {
      socket.on('message', (rawMsg) => {
        const msg = rawMsg.toString()
        if (msg.startsWith('S:')) {
          subscribeCount++
          const pair = msg.slice(2)
          socket.send(JSON.stringify({ pair, value: price }))
        } else {
          try {
            const parsed = JSON.parse(msg)
            if (parsed.request === 'unsubscribe') {
              unsubscribeCount++
            }
          } catch {
            // Ignore non-JSON messages
          }
        }
      })
    })

    const adapter = createAdapter({})

    const testAdapter = await TestAdapter.startWithMockedCache(adapter, t.context)

    // First request with mixed-case base — triggers subscribe and populates cache
    await testAdapter.startBackgroundExecuteThenGetResponse(t, {
      requestData: { base: 'USDe', quote: 'USD' },
      expectedResponse: {
        data: { result: price },
        result: price,
        statusCode: 200,
      },
    })

    // Second request with all-lowercase — same cache key, should be a cache hit,
    // but overwrites the subscription set value with the lowercase variant
    const response = await testAdapter.request({ base: 'usde', quote: 'usd' })
    t.is(response.statusCode, 200)

    // Advance clock to trigger another background execute cycle
    await runAllUntilTime(t.context.clock, BACKGROUND_EXECUTE_MS_WS + 100)

    // Capture the counters before cleanup so assertions run after cleanup.
    // Closing the API first (without await) signals the background executor to shut
    // down via fake-timer-driven setImmediate; runToLastAsync then fires all pending
    // fake timers (Fastify's close, bg executor sleep) so the executor exits cleanly.
    const capturedSubscribeCount = subscribeCount
    const capturedUnsubscribeCount = unsubscribeCount

    testAdapter.api.close()
    mockWsServer.close()
    await t.context.clock.runToLastAsync()

    // With the bug: subscribeCount === 2, unsubscribeCount === 1 (unneccesary unsub+resub
    // caused by case mismatch between desiredSubs and localSubscriptions)
    // After the fix: subscribeCount === 1, unsubscribeCount === 0
    t.is(capturedSubscribeCount, 1)
    t.is(capturedUnsubscribeCount, 0)
  },
)

test.serial(
  'both request variants continue receiving data with case-insensitive provider',
  async (t) => {
    // Regression test (user-visible impact). With a case-insensitive streaming provider,
    // two requests that differ only in casing should both continue receiving data.
    //
    // The bug:
    //   1. Request A { base: 'USDe' } subscribes; localSubscriptions=['USDe/USD']
    //   2. Request B { base: 'usde' } overwrites the subscription-set value with lowercase
    //   3. Next bg execute: desiredSubs=['usde/usd'] ≠ localSubscriptions=['USDe/USD']
    //      → sendMessages sends subscribes first, then unsubscribes:
    //          subscribe   usde/usd  → provider (case-insensitive) starts/restarts feed
    //          unsubscribe USDe/USD  → provider treats as the same feed and kills it
    //   4. After the cycle: localSubscriptions=desiredSubs=['usde/usd'] → no diff on
    //      the next execute → feed is permanently dead, cache expires → 504
    //
    // CACHE_MAX_AGE is reduced so the test can observe the expiry without waiting the
    // full default 90 s. After the fix: no unnecessary sub/unsub, feed stays alive,
    // both variants return 200.

    mockWebSocketProvider(WebSocketClassProvider)
    const mockWsServer = new Server(ENDPOINT_URL, { mock: false })

    // Simulate a case-insensitive streaming provider: sends data on subscribe and
    // pushes periodic updates; unsubscribe kills the feed.
    let feedActive = false
    let activePair = ''
    let intervalTimer: ReturnType<typeof setInterval> | null = null

    mockWsServer.on('connection', (socket) => {
      socket.on('message', (rawMsg) => {
        const msg = rawMsg.toString()
        if (msg.startsWith('S:')) {
          feedActive = true
          activePair = msg.slice(2)
          socket.send(JSON.stringify({ pair: activePair, value: price }))
          // Periodic pushes simulate a streaming provider keeping the cache warm.
          if (intervalTimer) { clearInterval(intervalTimer) }
          intervalTimer = setInterval(() => {
            if (feedActive) { socket.send(JSON.stringify({ pair: activePair, value: price })) }
          }, BACKGROUND_EXECUTE_MS_WS)
        } else {
          try {
            const parsed = JSON.parse(msg)
            if (parsed.request === 'unsubscribe') {
              feedActive = false
              if (intervalTimer) {
                clearInterval(intervalTimer)
                intervalTimer = null
              }
            }
          } catch {
            // Ignore non-JSON messages
          }
        }
      })
      socket.on('close', () => {
        if (intervalTimer) { clearInterval(intervalTimer) }
      })
    })

    // Reduced CACHE_MAX_AGE so expiry is observable within the test without waiting
    // the full default 90 s. Must be > BACKGROUND_EXECUTE_MS_WS so periodic pushes
    // keep the cache warm when the feed is healthy (no bug).
    const cacheMaxAge = Math.round(1.5 * BACKGROUND_EXECUTE_MS_WS) // 7500ms
    const adapter = createAdapter({
      CACHE_MAX_AGE: cacheMaxAge,
    })

    const testAdapter = await TestAdapter.startWithMockedCache(adapter, t.context)

    // First request (mixed case) — subscribes to provider, starts periodic pushes.
    await testAdapter.startBackgroundExecuteThenGetResponse(t, {
      requestData: { base: 'USDe', quote: 'USD' },
      expectedResponse: { data: { result: price }, result: price, statusCode: 200 },
    })

    // Second request (lowercase) — same cache key, gets a hit. But it also overwrites
    // the subscription set value, setting up the unnecessary unsub/resub cycle.
    const hit = await testAdapter.request({ base: 'usde', quote: 'usd' })
    t.is(hit.statusCode, 200)

    // Advance past two bg-execute cycles and one full cacheMaxAge window.
    // With bug: feed is permanently dead after cycle 1 (~5000ms); cache expires at
    //   ~5000ms + 7500ms = ~12500ms → both variants return 504 by assertion time.
    // Without bug: periodic pushes keep refreshing the cache → both variants return 200.
    await runAllUntilTime(t.context.clock, 2 * BACKGROUND_EXECUTE_MS_WS + cacheMaxAge + 100)
    const response1 = await testAdapter.request({ base: 'USDe', quote: 'USD' })
    t.is(response1.statusCode, 200)

    const response2 = await testAdapter.request({ base: 'usde', quote: 'usd' })
    t.is(response2.statusCode, 200)

    testAdapter.api.close()
    mockWsServer.close()
    await t.context.clock.runToLastAsync()
  },
)
