import { installTimers } from '../helper'
import untypedTest, { TestFn } from 'ava'
import axios, { AxiosResponse } from 'axios'
import MockAdapter from 'axios-mock-adapter'
import { FastifyInstance } from 'fastify'
import { Adapter, AdapterEndpoint } from '../../src/adapter'
import { CompositeTransport } from '../../src/transports/composite'
import { HttpTransport } from '../../src/transports'
import { AdapterRequest } from '../../src/util/types'
import { TestAdapter } from '../../src/util/testing-utils'
import { TypeFromDefinition } from '../../src/validation/input-params'
import { cacheTestInputParameters, CacheTestTransportTypes } from '../cache/helper'

const test = untypedTest as TestFn<{
  clock: ReturnType<typeof installTimers>
  testAdapter: TestAdapter
  api: FastifyInstance | undefined
}>

process.env['CACHE_POLLING_MAX_RETRIES'] = '20'
process.env['CACHE_POLLING_SLEEP_MS'] = '10'
process.env['RETRY'] = '0'
process.env['BACKGROUND_EXECUTE_MS_HTTP'] = '1'
process.env['API_TIMEOUT'] = '0'

const WS_PROVIDER = 'http://ea-composite-ws.test'
const REST_PROVIDER = 'http://ea-composite-rest.test'

const axiosMock = new MockAdapter(axios)

type CacheTestHttpTypes = CacheTestTransportTypes & {
  Provider: {
    RequestBody: unknown
    ResponseBody: { result: number }
  }
}

/** HTTP transport that counts `registerRequest` (subscription adds) like the old stub. */
class CountingCacheHttpTransport extends HttpTransport<CacheTestHttpTypes> {
  registerRequestCalls = 0

  constructor(logicalName: string, baseURL: string) {
    super({
      prepareRequests: (params) => ({
        params,
        request: {
          baseURL,
          url: '/price',
          method: 'GET',
        },
      }),
      parseResponse: (params, res: AxiosResponse<{ result: number }>) =>
        params.map((p) => ({
          params: p,
          response: {
            data: null,
            result: res.data.result,
          },
        })),
    })
    this.name = logicalName
  }

  override async registerRequest(
    req: AdapterRequest<TypeFromDefinition<CacheTestHttpTypes['Parameters']>>,
    settings: CacheTestHttpTypes['Settings'],
  ): Promise<void> {
    this.registerRequestCalls++
    return super.registerRequest(req, settings)
  }
}

test.before((t) => {
  t.context.clock = installTimers()
})

test.afterEach(async (t) => {
  axiosMock.resetHandlers()
  t.context.clock.reset()
  await t.context.testAdapter?.api.close()
})

test.serial(
  'composite transport merges child writes using shouldUpdate when run under an adapter',
  async (t) => {
    axiosMock.onGet(`${WS_PROVIDER}/price`).reply(200, { result: 10 })
    axiosMock.onGet(`${REST_PROVIDER}/price`).reply(200, { result: 100 })

    const ws = new CountingCacheHttpTransport('ws', WS_PROVIDER)
    const rest = new CountingCacheHttpTransport('rest', REST_PROVIDER)

    const composite = new CompositeTransport<CacheTestHttpTypes>({
      transports: { ws: ws, rest: rest },
      shouldUpdate: (next, current) => (next?.result ?? 0) > (current?.result ?? 0),
    })

    const adapter = new Adapter({
      name: 'TEST',
      defaultEndpoint: 'test',
      endpoints: [
        new AdapterEndpoint({
          name: 'test',
          inputParameters: cacheTestInputParameters,
          transport: composite,
        }),
      ],
    })

    const testAdapter = await TestAdapter.start(adapter, t.context)

    t.is(ws.name, 'ws')
    t.is(rest.name, 'rest')

    const res = await testAdapter.request({ base: 'ETH', factor: 5 })

    t.is(res.statusCode, 200)
    t.is(res.json().result, 100)
    t.is(ws.registerRequestCalls, 1)
    t.is(rest.registerRequestCalls, 1)
  },
)
