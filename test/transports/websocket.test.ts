import FakeTimers, { InstalledClock } from '@sinonjs/fake-timers'
import untypedTest, { TestFn } from 'ava'
import axios, { AxiosError } from 'axios'
import { Server, WebSocket } from 'mock-socket'
import { AddressInfo } from 'net'
import { expose } from '../../src'
import { Adapter, AdapterEndpoint, AdapterParams } from '../../src/adapter'
import { SettingsMap } from '../../src/config'
import { DEFAULT_SHARED_MS_BETWEEN_REQUESTS } from '../../src/rate-limiting'
import { WebSocketClassProvider, WebSocketTransport } from '../../src/transports'
import { SingleNumberResultResponse } from '../../src/util'
import { InputParameters } from '../../src/validation'
import { assertEqualResponses, MockCache, runAllUntilTime } from '../util'

interface AdapterRequestParams {
  base: string
  quote: string
}

export const test = untypedTest as TestFn<{
  clock: InstalledClock
}>

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

const CACHE_MAX_AGE = 1000

// Disable retries to make the testing flow easier
process.env['CACHE_POLLING_MAX_RETRIES'] = '0'

const price = 251324

type WebSocketTypes = {
  Request: {
    Params: AdapterRequestParams
  }
  Response: SingleNumberResultResponse
  CustomSettings: SettingsMap
  Provider: {
    WsMessage: ProviderMessage
  }
}

const createAdapter = (adapterParams?: Partial<AdapterParams<SettingsMap>>): Adapter => {
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

  const adapter = new Adapter({
    name: 'TEST',
    defaultEndpoint: 'test',
    endpoints: [webSocketEndpoint],
    ...adapterParams,
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
  // Create mocked cache so we can listen when values are set
  // This is a more reliable method than expecting precise clock timings
  const mockCache = new MockCache()

  const adapter = createAdapter()

  // Start up adapter
  const api = await expose(adapter, {
    cache: mockCache,
  })
  const address = `http://localhost:${(api?.server.address() as AddressInfo)?.port}`

  const makeRequest = () =>
    axios.post(address, {
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
  // clock.tickAsync(10)
  // Wait for the failed cache get -> instant 504
  const error = await errorPromise
  t.is(error?.response?.status, 504)

  // Advance clock so that the batch warmer executes once again and wait for the cache to be set
  const cacheValueSetPromise = mockCache.waitForNextSet()
  await t.context.clock.tickAsync(DEFAULT_SHARED_MS_BETWEEN_REQUESTS + 10)
  await cacheValueSetPromise

  // Second request should find the response in the cache
  const response = await makeRequest()

  t.is(response.status, 200)
  assertEqualResponses(t, response.data, {
    data: {
      result: price,
    },
    result: price,
    statusCode: 200,
  })

  // Wait until the cache expires, and the subscription is out
  await t.context.clock.tickAsync(
    Math.ceil(CACHE_MAX_AGE / adapter.config.WS_SUBSCRIPTION_TTL) *
      adapter.config.WS_SUBSCRIPTION_TTL +
      1,
  )

  // Now that the cache is out and the subscription no longer there, this should time out
  const error2: AxiosError | undefined = await t.throwsAsync(makeRequest)
  t.is(error2?.response?.status, 504)
  api?.close()
  mockWsServer.close()
  await t.context.clock.runAllAsync()
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

  const mockCache = new MockCache()

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

  const adapter = new Adapter({
    name: 'TEST',
    defaultEndpoint: 'test',
    endpoints: [webSocketEndpoint],
    envDefaultOverrides: {
      WS_SUBSCRIPTION_TTL: 100000000,
    },
  })

  const api = await expose(adapter, { cache: mockCache })

  const address = `http://localhost:${(api?.server.address() as AddressInfo)?.port}`

  const makeRequest = (newBase: string) =>
    axios.post(address, {
      data: {
        base: newBase,
        quote: 'USD',
      },
    })

  const fullRequest = async (newBase: string) => {
    // Expect the first response to time out
    const errorPromise: Promise<AxiosError | undefined> = t.throwsAsync(makeRequest(newBase))
    const error = await errorPromise
    t.is(error?.response?.status, 504)

    // Advance clock so that the background execute is called once again and wait for the cache to be set
    const cacheValueSetPromise = mockCache.waitForNextSet()
    await runAllUntilTime(t.context.clock, DEFAULT_SHARED_MS_BETWEEN_REQUESTS + 10)
    await cacheValueSetPromise

    // Second request should find the response in the cache
    const response = await makeRequest(newBase)
    t.is(response.status, 200)
    assertEqualResponses(t, response.data, {
      data: {
        result: price,
      },
      result: price,
      statusCode: 200,
    })
  }

  await fullRequest('BTC')
  t.is(connectionCounter, 1)
  await fullRequest('ETH')
  t.is(connectionCounter, 2)
  await fullRequest('MATIC')
  t.is(connectionCounter, 3)

  api?.close()
  mockWsServer.close()
  await t.context.clock.runAllAsync()
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

  const mockCache = new MockCache()

  const adapter = createAdapter({
    envDefaultOverrides: {
      WS_SUBSCRIPTION_TTL: 30000,
      WS_SUBSCRIPTION_UNRESPONSIVE_TTL,
    },
  })

  const api = await expose(adapter, { cache: mockCache })

  const address = `http://localhost:${(api?.server.address() as AddressInfo)?.port}`

  const makeRequest = () =>
    axios.post(address, {
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
  // Wait for the failed cache get -> instant 504
  const error = await errorPromise
  t.is(error?.response?.status, 504)

  // The WS connection should not send any messages to the EA, so we dvance the clock until
  // we reach the point where the EA will consider it unhealthy and reconnect.
  await runAllUntilTime(t.context.clock, DEFAULT_SHARED_MS_BETWEEN_REQUESTS * 2 + 100)

  // The connection was opened twice
  t.is(connectionCounter, 2)
  // The subscribe message was sent twice as well, since when we reopened we resubscribed to everything
  t.is(messageCounter, 2)

  api?.close()
  mockWsServer.close()
  await t.context.clock.runAllAsync()
})

test.serial(
  'does not crash the server when open handler rejects with error or throws',
  async (t) => {
    const base = 'ETH'
    const quote = 'DOGE'

    // Mock WS
    mockWebSocketProvider(WebSocketClassProvider)
    const mockWsServer = new Server(URL, { mock: false })
    mockWsServer.on('connection', (socket) => {
      socket.send(
        JSON.stringify({
          pair: `${base}/${quote}`,
          value: price,
        }),
      )
    })

    const mockCache = new MockCache()

    const transport = new WebSocketTransport<WebSocketTypes>({
      url: () => URL,
      handlers: {
        async open() {
          return new Promise((res, rej) => rej('Error from open handler'))
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

    const adapter = new Adapter({
      name: 'TEST',
      defaultEndpoint: 'test',
      endpoints: [webSocketEndpoint],
    })

    // Start up adapter
    const api = await expose(adapter, {
      cache: mockCache,
    })
    const address = `http://localhost:${(api?.server.address() as AddressInfo)?.port}`

    const makeRequest = () =>
      axios.post(address, {
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
    // clock.tickAsync(10)
    // Wait for the failed cache get -> instant 504
    const error = await errorPromise
    t.is(error?.response?.status, 504)

    // Advance clock so that the batch warmer executes once again and wait for the cache to be set
    const cacheValueSetPromise = mockCache.waitForNextSet()
    await t.context.clock.tickAsync(DEFAULT_SHARED_MS_BETWEEN_REQUESTS + 10)
    await cacheValueSetPromise

    // Second request should find the response in the cache
    const response = await makeRequest()

    t.is(response.status, 200)
    assertEqualResponses(t, response.data, {
      data: {
        result: price,
      },
      result: price,
      statusCode: 200,
    })

    // Wait until the cache expires, and the subscription is out
    await t.context.clock.tickAsync(
      Math.ceil(CACHE_MAX_AGE / adapter.config.WS_SUBSCRIPTION_TTL) *
        adapter.config.WS_SUBSCRIPTION_TTL +
        1,
    )

    // Now that the cache is out and the subscription no longer there, this should time out
    const error2: AxiosError | undefined = await t.throwsAsync(makeRequest)
    t.is(error2?.response?.status, 504)
    api?.close()
    mockWsServer.close()
    await t.context.clock.runAllAsync()
  },
)
