import { AxiosResponse } from 'axios'
import { Adapter, AdapterEndpoint } from '../../src/adapter'
import { BaseAdapterConfig } from '../../src/config'
import { HttpTransport } from '../../src/transports'
import { SingleNumberResultResponse } from '../../src/util'

export const buildHttpAdapter = (): Adapter => {
  return new Adapter({
    name: 'TEST',
    defaultEndpoint: 'test',
    endpoints: [
      new AdapterEndpoint({
        name: 'test',
        inputParameters,
        transport: new MockHttpTransport(),
      }),
    ],
  })
}

const URL = 'http://test-url.com'

interface AdapterRequestParams {
  from: string
  to: string
}

interface ProviderRequestBody {
  pairs: Array<{
    base: string
    quote: string
  }>
}

interface ProviderResponseBody {
  prices: Array<{
    pair: string
    price: number
  }>
}

type HttpEndpointTypes = {
  Request: {
    Params: AdapterRequestParams
  }
  Response: SingleNumberResultResponse
  Config: BaseAdapterConfig
  Provider: {
    RequestBody: ProviderRequestBody
    ResponseBody: ProviderResponseBody
  }
}

class MockHttpTransport extends HttpTransport<HttpEndpointTypes> {
  constructor() {
    super({
      prepareRequests: (params: AdapterRequestParams[]) => {
        return {
          params,
          request: {
            baseURL: URL,
            url: '/price',
            method: 'POST',
            data: {
              pairs: params.map((p) => ({ base: p.from, quote: p.to })),
            },
          },
        }
      },
      parseResponse: (params: AdapterRequestParams[], res: AxiosResponse<ProviderResponseBody>) => {
        return res.data.prices.map((p) => {
          const [from, to] = p.pair.split('/')
          return {
            params: { from, to },
            response: {
              data: {
                result: p.price,
              },
              result: p.price,
            },
          }
        })
      },
    })
  }
}

const inputParameters = {
  from: {
    type: 'string',
    required: true,
  },
  to: {
    type: 'string',
    required: true,
  },
} as const
