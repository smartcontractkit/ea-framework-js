import FakeTimers, { InstalledClock } from '@sinonjs/fake-timers'
import untypedTest, { TestFn } from 'ava'
import axios, { AxiosResponse } from 'axios'
import MockAdapter from 'axios-mock-adapter'
import { FastifyInstance } from 'fastify'
import { Adapter, AdapterEndpoint, EndpointContext } from '../../src/adapter'
import { AdapterConfig } from '../../src/config'

import { HttpTransport } from '../../src/transports'
import { ProviderResult } from '../../src/util'
import { TestAdapter } from '../util'

const test = untypedTest as TestFn<{
  clock: InstalledClock
  testAdapter: TestAdapter
  api: FastifyInstance | undefined
}>

const URL = 'http://test-url.com'
const endpoint = '/price'
const axiosMock = new MockAdapter(axios)

interface ProviderRequestBody {
  API_KEY: string
}

interface ProviderResponseBody {
  data: Array<{
    API_KEY: string
    price: number
  }>
}

interface Response {
  Data: {
    result: number
    api_key: string
  },
  Result: number
}

test.beforeEach((t) => {
  t.context.clock = FakeTimers.install()
})

test.afterEach(async (t) => {
  t.context.clock.uninstall()
  await t.context.testAdapter?.api.close()
})

type HttpTransportTypes = {
  Request: {
    Params: Record<string, never>
  }
  Response: Response
  Settings: typeof config.settings
  Provider: {
    RequestBody: ProviderRequestBody
    ResponseBody: ProviderResponseBody
  }
}

const BACKGROUND_EXECUTE_MS_HTTP = 1000

class MockHttpTransport extends HttpTransport<HttpTransportTypes> {
  backgroundExecuteCalls = 0

  constructor(private callSuper = false) {
    super({
      prepareRequests: (params) => ({
        params,
        request: {
          baseURL: URL,
          url: '/price',
          method: 'POST',
          data: {
            API_KEY: apiKey,
          }
        },
      }),
      parseResponse: (
        params: Record<string, never>[],
        res: AxiosResponse<ProviderResponseBody>,
      ): ProviderResult<HttpTransportTypes>[] => {
        return res.data?.data.map((p) => {
          return {
            params: {},
            response: {
              data: {
                result: p.price,
                api_key: `API KEY for request ${p.API_KEY}`
              },
              result: p.price,
            },
          }
        })
      },
    })
  }

  override async backgroundExecute(context: EndpointContext<HttpTransportTypes>): Promise<void> {
    const entries = await this.subscriptionSet.getAll()
    if (entries.length) {
      this.backgroundExecuteCalls++
    }
    if (this.callSuper) {
      return super.backgroundExecute(context)
    }
  }
}

// Disable retries to make the testing flow easier
process.env['CACHE_POLLING_MAX_RETRIES'] = '0'
process.env['RETRY'] = '0'
process.env['BACKGROUND_EXECUTE_MS_HTTP'] = BACKGROUND_EXECUTE_MS_HTTP.toString()
process.env['API_TIMEOUT'] = '0'

const price = 1234
const apiKey = 'mock-api-key'

axiosMock
  .onPost(URL + endpoint, {
    API_KEY: apiKey,
  })
  .reply(200, {
    data: [
      {
        API_KEY: apiKey,
        price,
      },
    ],
  })

export const config = new AdapterConfig({
  API_KEY: {
    description: 'API key',
    type: 'string',
    required: true,
    sensitive: true,
  },
})


test.serial('sensitive settings are censored in the response cache', async (t) => {
  process.env['API_KEY'] = apiKey
  const adapter = new Adapter({
    name: 'TEST',
    defaultEndpoint: 'test',
    config,
    endpoints: [
      new AdapterEndpoint({
        name: 'test',
        inputParameters: {},
        transport: new MockHttpTransport(true),
      }),
    ],
  })

  // Start the adapter
  const testAdapter = await TestAdapter.startWithMockedCache(adapter, t.context)
  await testAdapter.startBackgroundExecuteThenGetResponse(t, {
    requestData: {},
    expectedResponse: {
      data: {
        result: price,
        api_key: 'API KEY for request [API_KEY REDACTED]'
      },
      result: price,
      statusCode: 200,
    },
  })
})