import untypedTest, { TestFn } from 'ava'
import axios, { AxiosRequestConfig, AxiosResponse } from 'axios'
import MockAdapter from 'axios-mock-adapter'
import { Server, WebSocket } from 'mock-socket'
import { Adapter, AdapterEndpoint, EndpointContext } from '../../src/adapter'
import { AdapterConfig, SettingsDefinitionMap } from '../../src/config'
import {
  HttpTransport,
  SSEConfig,
  SseTransport,
  TransportRoutes,
  WebSocketClassProvider,
  WebSocketTransport,
} from '../../src/transports'
import { InputParameters } from '../../src/validation'
import { TestAdapter } from '../util'

const test = untypedTest as TestFn<{
  testAdapter: TestAdapter<typeof adapterConfig>
}>

interface ProviderRequestBody {
  base: string
  quote: string
}

interface ProviderResponseBody {
  price: number
}

interface AdapterRequestParams {
  from: string
  to: string
}

interface ProviderMessage {
  pair: string
  value: number
}

const settings = {
  TEST_SETTING: {
    type: 'string',
    description: 'test setting',
    default: 'test',
    required: false,
    sensitive: false,
  },
} satisfies SettingsDefinitionMap

const adapterConfig = new AdapterConfig(settings)

const restUrl = 'http://test-url.com'
const websocketUrl = 'wss://test-ws.com/asd'
const axiosMock = new MockAdapter(axios)

type BaseEndpointTypes = {
  Request: {
    Params: AdapterRequestParams
  }
  Response: {
    Data: {
      price: number
    }
    Result: number
  }
  Settings: typeof adapterConfig.settings
}

type WebSocketTypes = BaseEndpointTypes & {
  Provider: {
    WsMessage: ProviderMessage
  }
}

const from = 'ETH'
const to = 'USD'
const price = 1500

const inputParameters = {
  from: {
    description: 'from',
    required: true,
    type: 'string',
  },
  to: {
    description: 'to',
    required: true,
    type: 'string',
  },
} satisfies InputParameters

class MockWebSocketTransport extends WebSocketTransport<WebSocketTypes> {
  public backgroundExecuteCalls = 0

  constructor() {
    super({
      url: () => websocketUrl,
      handlers: {
        async open() {
          return
        },

        message(message) {
          return [
            {
              params: { from: 'ETH', to: 'USD' },
              response: {
                data: { price: message.value },
                result: message.value,
              },
            },
          ]
        },
      },
      builders: {
        subscribeMessage: (params: AdapterRequestParams) => ({
          request: 'subscribe',
          pair: `${params.from}/${params.to}`,
        }),
        unsubscribeMessage: (params: AdapterRequestParams) => ({
          request: 'unsubscribe',
          pair: `${params.from}/${params.to}`,
        }),
      },
    })
  }

  override async backgroundExecute(context: EndpointContext<any>): Promise<void> {
    this.backgroundExecuteCalls++
    return super.backgroundExecute(context)
  }
}

const mockWebSocketProvider = (provider: typeof WebSocketClassProvider): void => {
  // Extend mock WebSocket class to bypass protocol headers error
  class MockWebSocket extends WebSocket {
    constructor(url: string, protocol: string | string[] | Record<string, string> | undefined) {
      super(url, protocol instanceof Object ? undefined : protocol)
    }
  }

  // Need to disable typing, the mock-socket impl does not implement the ws interface fully
  provider.set(MockWebSocket as any) // eslint-disable-line @typescript-eslint/no-explicit-any
}

mockWebSocketProvider(WebSocketClassProvider)
const mockWsServer = new Server(websocketUrl, { mock: false })
mockWsServer.on('connection', (socket) => {
  let counter = 0
  const parseMessage = () => {
    if (counter++ === 0) {
      socket.send(
        JSON.stringify({
          from,
          to,
          value: price,
        }),
      )
    }
  }
  socket.on('message', parseMessage)
})

type HttpTypes = BaseEndpointTypes & {
  Provider: {
    RequestBody: {
      pairs: ProviderRequestBody[]
    }
    ResponseBody: ProviderResponseBody
  }
}

class MockHttpTransport extends HttpTransport<HttpTypes> {
  backgroundExecuteCalls = 0

  constructor(private callSuper = false) {
    super({
      prepareRequests: (params: AdapterRequestParams[]) => {
        return {
          params,
          request: {
            baseURL: restUrl,
            url: '/price',
            method: 'POST',
            data: {
              pairs: params.map((p) => ({ base: p.from, quote: p.to })),
            },
          },
        }
      },
      parseResponse: (params: AdapterRequestParams[], res: AxiosResponse<any>) => {
        return res.data.prices.map((p: any) => {
          const [base, quote] = p.pair.split('/')
          return {
            params: { from: base, to: quote },
            value: p.price,
          }
        })
      },
    })
  }

  override async backgroundExecute(context: EndpointContext<any>): Promise<void> {
    this.backgroundExecuteCalls++
    if (this.callSuper) {
      super.backgroundExecute(context)
    }
  }
}

type SSETypes = BaseEndpointTypes & {
  Provider: {
    RequestBody: {
      pairs: ProviderRequestBody[]
    }
    ResponseBody: ProviderResponseBody
  }
}

class MockSseTransport extends SseTransport<SSETypes> {
  public backgroundExecuteCalls = 0

  constructor() {
    super({
      prepareSSEConnectionConfig: (): SSEConfig => {
        return { url: restUrl }
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
          parseResponse: (evt: MessageEvent) => {
            return [
              {
                params: { from: 'ETH', to: 'USD' },
                response: {
                  data: { price: evt.data.price },
                  result: evt.data.price,
                },
              },
            ]
          },
        },
      ],
    })
  }

  override async backgroundExecute(context: EndpointContext<any>): Promise<void> {
    this.backgroundExecuteCalls++
    return super.backgroundExecute(context)
  }
}

const transports = new TransportRoutes<BaseEndpointTypes>()
  .register('websocket', new MockWebSocketTransport())
  .register('batch', new MockHttpTransport())
  .register('sse', new MockSseTransport())

test.beforeEach(async (t) => {
  const sampleEndpoint = new AdapterEndpoint<BaseEndpointTypes>({
    inputParameters,
    name: 'price', // /price
    transportRoutes: transports,
  })

  const customConfig = new AdapterConfig(settings, {
    envDefaultOverrides: {
      LOG_LEVEL: 'debug',
      METRICS_ENABLED: false,
      CACHE_POLLING_SLEEP_MS: 10,
      CACHE_POLLING_MAX_RETRIES: 0,
    },
  })

  const sampleAdapter = new Adapter({
    name: 'TEST',
    defaultEndpoint: 'price',
    config: customConfig,
    endpoints: [sampleEndpoint],
    rateLimiting: {
      tiers: {
        default: {
          rateLimit1s: 5,
        },
      },
    },
  })

  const testAdapter = await TestAdapter.startWithMockedCache(sampleAdapter, t.context)

  t.context = {
    testAdapter,
  }
})

test.serial('endpoint routing errors on invalid transport', async (t) => {
  t.is(
    Object.keys(transports).find((s) => s === 'INVALID'),
    undefined,
  )

  const error = await t.context.testAdapter.request({
    from,
    to,
    transport: 'INVALID',
  })
  t.is(error.statusCode, 400)
})

test.serial('endpoint routing can route to HttpTransport', async (t) => {
  axiosMock
    .onPost(`${restUrl}/price`, {
      pairs: [
        {
          base: from,
          quote: to,
        },
      ],
    })
    .reply(200, {
      prices: [
        {
          pair: `${from}/${to}`,
          price,
        },
      ],
    })

  const error = await t.context.testAdapter.request({
    from,
    to,
    transport: 'BATCH',
  })

  t.is(error.statusCode, 504)
  const internalTransport = transports.get('batch') as MockHttpTransport
  t.assert(internalTransport.backgroundExecuteCalls > 0)
})

test.serial('endpoint routing can route to WebSocket transport', async (t) => {
  const error = await t.context.testAdapter.request({
    from,
    to,
    transport: 'WEBSOCKET',
  })
  t.is(error?.statusCode, 504)
  const internalTransport = transports.get('websocket') as MockWebSocketTransport
  t.assert(internalTransport.backgroundExecuteCalls > 0)
})

test.serial('endpoint routing can route to SSE transport', async (t) => {
  axiosMock
    .onPost(`${restUrl}/sub`)
    .reply(200, {
      message: 'Successfully subscribed to ETH/USD',
    })
    .onPost(`${restUrl}/unsub`)
    .reply(200, {
      message: 'Successfully unsubscribed from ETH/USD',
    })
    .onPost(`${restUrl}/ping`)
    .reply(200, {
      message: 'Pong',
    })

  const error = await t.context.testAdapter.request({
    from,
    to,
    transport: 'SSE',
  })
  t.is(error.statusCode, 504)

  const internalTransport = transports.get('sse') as MockSseTransport
  t.assert(internalTransport.backgroundExecuteCalls > 0)
})

test.serial('custom router is applied to get valid transport to route to', async (t) => {
  const endpoint = new AdapterEndpoint<BaseEndpointTypes>({
    inputParameters,
    name: 'price', // /price
    transportRoutes: transports,
    customRouter: () => 'batch',
  })

  const customConfig = new AdapterConfig(settings, {
    envDefaultOverrides: {
      LOG_LEVEL: 'debug',
      METRICS_ENABLED: false,
      CACHE_POLLING_SLEEP_MS: 10,
      CACHE_POLLING_MAX_RETRIES: 0,
    },
  })

  const adapter = new Adapter({
    name: 'TEST',
    defaultEndpoint: 'price',
    config: customConfig,
    endpoints: [endpoint],
    rateLimiting: {
      tiers: {
        default: {
          rateLimit1s: 5,
        },
      },
    },
  })

  const testAdapter = await TestAdapter.start(adapter, t.context)

  axiosMock
    .onPost(`${restUrl}/price`, {
      pairs: [
        {
          base: from,
          quote: to,
        },
      ],
    })
    .reply(200, {
      prices: [
        {
          pair: `${from}/${to}`,
          price,
        },
      ],
    })

  const error = await testAdapter.request({
    from,
    to,
    transport: 'BATCH',
  })
  t.is(error.statusCode, 504)

  const internalTransport = transports.get('batch') as MockHttpTransport
  t.assert(internalTransport.backgroundExecuteCalls > 0)
})

test.serial('custom router returns invalid transport and request fails', async (t) => {
  const endpoint = new AdapterEndpoint<BaseEndpointTypes>({
    inputParameters,
    name: 'price', // /price
    transportRoutes: transports,
    customRouter: () => 'qweqwe',
  })

  const customConfig = new AdapterConfig(settings, {
    envDefaultOverrides: {
      LOG_LEVEL: 'debug',
      METRICS_ENABLED: false,
      CACHE_POLLING_SLEEP_MS: 10,
      CACHE_POLLING_MAX_RETRIES: 0,
    },
  })

  const adapter = new Adapter({
    name: 'TEST',
    defaultEndpoint: 'price',
    endpoints: [endpoint],
    config: customConfig,
    rateLimiting: {
      tiers: {
        default: {
          rateLimit1s: 5,
        },
      },
    },
  })

  const testAdapter = await TestAdapter.start(adapter, t.context)

  axiosMock
    .onPost(`${restUrl}/price`, {
      pairs: [
        {
          base: from,
          quote: to,
        },
      ],
    })
    .reply(200, {
      prices: [
        {
          pair: `${from}/${to}`,
          price,
        },
      ],
    })

  const error = await testAdapter.request({
    from,
    to,
    transport: 'BATCH',
  })
  t.is(error.statusCode, 400)
  t.is(
    error.json().error.message,
    'No transport found for key "qweqwe", must be one of ["websocket","batch","sse"]',
  )
})

test.serial('missing transport in input params with no default fails request', async (t) => {
  const endpoint = new AdapterEndpoint<BaseEndpointTypes>({
    inputParameters,
    name: 'price', // /price
    transportRoutes: transports,
  })

  const customConfig = new AdapterConfig(settings, {
    envDefaultOverrides: {
      LOG_LEVEL: 'debug',
      METRICS_ENABLED: false,
      CACHE_POLLING_SLEEP_MS: 10,
      CACHE_POLLING_MAX_RETRIES: 0,
    },
  })

  const adapter = new Adapter({
    name: 'TEST',
    defaultEndpoint: 'price',
    config: customConfig,
    endpoints: [endpoint],
    rateLimiting: {
      tiers: {
        default: {
          rateLimit1s: 5,
        },
      },
    },
  })

  const testAdapter = await TestAdapter.start(adapter, t.context)

  axiosMock
    .onPost(`${restUrl}/price`, {
      pairs: [
        {
          base: from,
          quote: to,
        },
      ],
    })
    .reply(200, {
      prices: [
        {
          pair: `${from}/${to}`,
          price,
        },
      ],
    })

  const error = await testAdapter.request({
    from,
    to,
  })
  t.is(error.statusCode, 400)
  t.is(
    error.json().error.message,
    'No result was fetched from a custom router, no transport was specified in the input parameters, and this endpoint does not have a default transport set.',
  )
})

test.serial('missing transport in input params with default succeeds', async (t) => {
  const endpoint = new AdapterEndpoint<BaseEndpointTypes>({
    inputParameters,
    name: 'price', // /price
    transportRoutes: transports,
    defaultTransport: 'batch',
  })

  const customConfig = new AdapterConfig(settings, {
    envDefaultOverrides: {
      LOG_LEVEL: 'debug',
      METRICS_ENABLED: false,
      CACHE_POLLING_SLEEP_MS: 10,
      CACHE_POLLING_MAX_RETRIES: 0,
    },
  })

  const adapter = new Adapter({
    name: 'TEST',
    defaultEndpoint: 'price',
    endpoints: [endpoint],
    config: customConfig,
    rateLimiting: {
      tiers: {
        default: {
          rateLimit1s: 5,
        },
      },
    },
  })

  const testAdapter = await TestAdapter.start(adapter, t.context)

  axiosMock
    .onPost(`${restUrl}/price`, {
      pairs: [
        {
          base: from,
          quote: to,
        },
      ],
    })
    .reply(200, {
      prices: [
        {
          pair: `${from}/${to}`,
          price,
        },
      ],
    })

  const error = await testAdapter.request({
    from,
    to,
  })
  t.is(error.statusCode, 504)

  const internalTransport = transports.get('batch') as MockHttpTransport
  t.assert(internalTransport.backgroundExecuteCalls > 0)
})

test.serial('transport creation fails if transport names are not acceptable', async (t) => {
  const invalidNames = ['WebSocket', 'HTTP', 'hyphen-test', 'camel_test', 'space test']

  for (const name of invalidNames) {
    t.throws(
      () =>
        new AdapterEndpoint({
          name: 'test',
          inputParameters,
          transportRoutes: new TransportRoutes<BaseEndpointTypes>().register(
            name,
            transports.get('batch'),
          ),
        }),
    )
  }
})
