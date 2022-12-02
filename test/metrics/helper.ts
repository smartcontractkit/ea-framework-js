import { AxiosRequestConfig, AxiosResponse } from 'axios'
import { Adapter, AdapterEndpoint } from '../../src/adapter'
import { SettingsMap } from '../../src/config'
import { BatchWarmingTransport } from '../../src/transports'
import { SingleNumberResultResponse } from '../../src/util'

// Parse metrics scrape into object to use for tests
export const parsePromMetrics = (data: string): Map<string, number> => {
  const responseLines = data.split('\n')
  const metricsMap = new Map<string, number>()
  responseLines.forEach((line) => {
    if (!line.startsWith('#') && line !== '') {
      const metric = line.split(' ')
      const nameLabel = metric[0]
      const value = Number(metric[1])
      metricsMap.set(nameLabel, value)
    }
  })
  return metricsMap
}

export const buildBatchAdapter = (): Adapter => {
  return new Adapter({
    name: 'TEST',
    defaultEndpoint: 'test',
    endpoints: [
      new AdapterEndpoint({
        name: 'test',
        inputParameters,
        transport: new MockBatchWarmingTransport(),
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

type BatchEndpointTypes = {
  Request: {
    Params: AdapterRequestParams
  }
  Response: SingleNumberResultResponse
  CustomSettings: SettingsMap
  Provider: {
    RequestBody: ProviderRequestBody
    ResponseBody: ProviderResponseBody
  }
}

class MockBatchWarmingTransport extends BatchWarmingTransport<BatchEndpointTypes> {
  constructor() {
    super({
      prepareRequest: (params: AdapterRequestParams[]): AxiosRequestConfig<ProviderRequestBody> => {
        return {
          baseURL: URL,
          url: '/price',
          method: 'POST',
          data: {
            pairs: params.map((p) => ({ base: p.from, quote: p.to })),
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
