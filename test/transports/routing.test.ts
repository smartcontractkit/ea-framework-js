import untypedTest, { TestFn } from 'ava'
import axios, { AxiosError, AxiosRequestConfig, AxiosResponse } from 'axios'
import { Server, WebSocket } from 'mock-socket'
import { AddressInfo } from 'net'
import nock from 'nock'
import { expose } from '../../src'
import { Adapter, EndpointContext, AdapterEndpoint } from '../../src/adapter'
import { SettingsMap } from '../../src/config'
import {
  BatchWarmingTransport,
  RestTransport,
  SSEConfig,
  SSETransport,
  Transport,
  WebSocketClassProvider,
  WebSocketTransport,
} from '../../src/transports'
import { RoutingTransport } from '../../src/transports/meta'
import { assertEqualResponses, MockCache } from '../util'

const test = untypedTest as TestFn<{
  endpoint: AdapterEndpoint<BaseEndpointTypes>
  adapter: Adapter
  from: string
  to: string
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
  routeToTransport: string
}

interface ProviderMessage {
  pair: string
  value: number
}

const CustomSettings: SettingsMap = {
  TEST_SETTING: {
    type: 'string',
    description: 'test setting',
    default: 'test',
    required: false,
    sensitive: false,
  },
}

const restUrl = 'http://test-url.com'
const websocketUrl = 'wss://test-ws.com/asd'

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
  CustomSettings: SettingsMap
}

const restTransport = () => {
  const urlEndpoint = `price`
  return new RestTransport<
    BaseEndpointTypes & {
      Provider: {
        RequestBody: ProviderRequestBody
        ResponseBody: ProviderResponseBody
      }
    }
  >({
    prepareRequest: (req): AxiosRequestConfig<ProviderRequestBody> => {
      return {
        baseURL: restUrl,
        url: urlEndpoint,
        method: 'GET',
        params: {
          base: req.requestContext.data.from,
          quote: req.requestContext.data.to,
        },
      }
    },
    parseResponse: (req, res) => {
      return {
        data: { price: res.data.price },
        statusCode: 200,
        result: res.data.price,
      }
    },
    options: {
      requestCoalescing: {
        enabled: true,
        entropyMax: 0,
      },
    },
  })
}

type WebSocketTypes = BaseEndpointTypes & {
  Provider: {
    WsMessage: ProviderMessage
  }
}

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
              params: { from: 'ETH', to: 'USD', routeToTransport: 'WEBSOCKET' },
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

type BatchWarmingTypes = BaseEndpointTypes & {
  Provider: {
    RequestBody: {
      pairs: ProviderRequestBody[]
    }
    ResponseBody: ProviderResponseBody
  }
}

class MockBatchWarmingTransport extends BatchWarmingTransport<BatchWarmingTypes> {
  backgroundExecuteCalls = 0

  constructor(private callSuper = false) {
    super({
      prepareRequest: (params: AdapterRequestParams[]) => {
        return {
          baseURL: restUrl,
          url: '/price',
          method: 'POST',
          data: {
            pairs: params.map((p) => ({ base: p.from, quote: p.to })),
          },
        }
      },
      parseResponse: (params: AdapterRequestParams[], res: AxiosResponse<any>) => {
        return res.data.prices.map((p: any) => {
          const [from, to] = p.pair.split('/')
          return {
            params: { from, to },
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
class MockSSETransport extends SSETransport<SSETypes> {
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
                params: { from: 'ETH', to: 'USD', routeToTransport: 'SSE' },
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

const transports: {
  [key: string]: Transport<BaseEndpointTypes>
} = {
  REST: restTransport(),
  WEBSOCKET: new MockWebSocketTransport(),
  BATCH: new MockBatchWarmingTransport(),
  SSE: new MockSSETransport(),
}

// Route function is used to select an adapter based on the supplied string, routeToTransport
const routingTransport = new RoutingTransport<BaseEndpointTypes>(transports, (req, _) => {
  return req.requestContext.data.routeToTransport
})

test.before(() => {
  nock.disableNetConnect()
  nock.enableNetConnect('localhost')
})

test.after(() => {
  nock.restore()
})

test.beforeEach((t) => {
  const endpoint = new AdapterEndpoint<BaseEndpointTypes>({
    inputParameters: {
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
      routeToTransport: {
        description: 'which transport to route to',
        required: true,
        type: 'string',
      },
    },
    name: 'price', // /price
    transport: routingTransport,
  })

  const adapter = new Adapter<typeof CustomSettings>({
    name: 'TEST',
    defaultEndpoint: 'price',
    endpoints: [endpoint],
    rateLimiting: {
      tiers: {
        default: {
          rateLimit1s: 5,
        },
      },
    },
    envDefaultOverrides: {
      LOG_LEVEL: 'debug',
      METRICS_ENABLED: false,
      CACHE_POLLING_SLEEP_MS: 10,
      CACHE_POLLING_MAX_RETRIES: 0,
    },
  })

  t.context = {
    adapter,
    endpoint,
    from: 'ETH',
    to: 'USD',
  }
})

test.serial('routing transport errors on invalid transport', async (t) => {
  const { adapter, from, to } = t.context
  const api = await expose(adapter)
  const address = `http://localhost:${(api?.server.address() as AddressInfo)?.port}`

  t.is(
    Object.keys(transports).find((s) => s === 'INVALID'),
    undefined,
  )
  const makeRequest = () =>
    axios.post(address, {
      data: {
        from,
        to,
        routeToTransport: 'INVALID',
      },
    })

  const error: AxiosError | undefined = await t.throwsAsync(makeRequest)
  t.is(error?.response?.status, 400)
})

test.serial('RoutingTransport can route to RestTransport', async (t) => {
  const { adapter, from, to } = t.context
  const api = await expose(adapter)
  const address = `http://localhost:${(api?.server.address() as AddressInfo)?.port}`
  const price = 1500
  nock(restUrl)
    .get('/price')
    .query({
      base: from,
      quote: to,
    })
    .reply(200, {
      price,
      verbose: 'DP data',
    })

  const response = await axios.post(address, {
    data: {
      from,
      to,
      routeToTransport: 'REST',
    },
  })

  t.is(response.status, 200)
  assertEqualResponses(t, response.data, {
    data: { price },
    result: price,
    statusCode: 200,
  })
})

test.serial('RoutingTransport can route to BatchWarmingTransport', async (t) => {
  const { adapter, from, to } = t.context
  const api = await expose(adapter)

  const address = `http://localhost:${(api?.server.address() as AddressInfo)?.port}`
  const price = 1500

  nock(restUrl)
    .post('/price', {
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
    .persist()

  const makeRequest = () =>
    axios.post(address, {
      data: {
        from,
        to,
        routeToTransport: 'BATCH',
      },
    })

  const error: AxiosError | undefined = await t.throwsAsync(makeRequest)

  t.is(error?.response?.status, 504)
  const internalTransport = transports['BATCH'] as MockBatchWarmingTransport
  t.assert(internalTransport.backgroundExecuteCalls > 0)
})

test.serial('RoutingTransport can route to WebSocket transport', async (t) => {
  const { adapter, from, to } = t.context
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
  const mockCache = new MockCache(adapter.config.CACHE_MAX_ITEMS)
  const api = await expose(adapter, { cache: mockCache })
  const address = `http://localhost:${(api?.server.address() as AddressInfo)?.port}`
  const price = 1500

  const makeRequest = () => {
    return axios.post(address, {
      data: {
        from,
        to,
        routeToTransport: 'WEBSOCKET',
      },
    })
  }
  const error: AxiosError | undefined = await t.throwsAsync(makeRequest)
  t.is(error?.response?.status, 504)
  const internalTransport = transports['WEBSOCKET'] as MockWebSocketTransport
  t.assert(internalTransport.backgroundExecuteCalls > 0)
})

test.serial('RoutingTransport can route to SSE transport', async (t) => {
  const { adapter, from, to } = t.context
  const api = await expose(adapter)
  const address = `http://localhost:${(api?.server.address() as AddressInfo)?.port}`

  const makeRequest = () => {
    return axios.post(address, {
      data: {
        from,
        to,
        routeToTransport: 'SSE',
      },
    })
  }

  nock(restUrl)
    .post('/sub')
    .times(2)
    .reply(200, {
      message: 'Successfully subscribed to ETH/USD',
    })
    .post('/unsub')
    .times(2)
    .reply(200, {
      message: 'Successfully unsubscribed from ETH/USD',
    })
    .post('/ping')
    .times(9999999)
    .reply(200, {
      message: 'Pong',
    })

  // Expect the first response to time out
  // The polling behavior is tested in the cache tests, so this is easier here.
  // Start the request:
  const earlyErrorPromise: Promise<AxiosError | undefined> = t.throwsAsync(makeRequest)
  // Advance enough time for the initial request async flow
  // clock.tickAsync(10)
  // Wait for the failed cache get -> instant 504
  const earlyError = await earlyErrorPromise
  t.is(earlyError?.response?.status, 504)

  const internalTransport = transports['SSE'] as MockSSETransport
  t.assert(internalTransport.backgroundExecuteCalls > 0)
})
