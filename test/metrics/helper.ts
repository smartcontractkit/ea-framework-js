import { AxiosResponse } from 'axios'
import { Adapter, AdapterEndpoint } from '../../src/adapter'
import { EmptyCustomSettings } from '../../src/config'
import { HttpTransport } from '../../src/transports'
import { SingleNumberResultResponse } from '../../src/util'
import { InputParameters } from '../../src/validation'

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
  Parameters: typeof inputParameters.definition
  Response: SingleNumberResultResponse
  Settings: EmptyCustomSettings
  Provider: {
    RequestBody: ProviderRequestBody
    ResponseBody: ProviderResponseBody
  }
}

class MockHttpTransport extends HttpTransport<HttpEndpointTypes> {
  constructor() {
    super({
      prepareRequests: (params) => {
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
      parseResponse: (params, res: AxiosResponse<ProviderResponseBody>) => {
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

const inputParameters = new InputParameters({
  from: {
    type: 'string',
    description: 'from',
    required: true,
  },
  to: {
    type: 'string',
    description: 'to',
    required: true,
  },
})
