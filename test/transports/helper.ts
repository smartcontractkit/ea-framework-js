import { AdapterEndpoint } from '../../src/adapter'
import { SettingsMap } from '../../src/config'
import { RestTransport } from '../../src/transports'

const URL = 'http://test-url.com'
const endpoint = '/price'

export interface AdapterRequestParams {
  from: string
  to: string
}

export interface ProviderRequestBody {
  base: string
  quote: string
}

export interface ProviderResponseBody {
  price: number
}

type TestEndpointTypes = {
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
  Provider: {
    RequestBody: ProviderRequestBody
    ResponseBody: ProviderResponseBody
  }
}

export const createAdapterEndpoint = () => {
  const restEndpointTransport = new RestTransport<TestEndpointTypes>({
    prepareRequest: (req) => {
      return {
        baseURL: URL,
        url: endpoint,
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

  return new AdapterEndpoint<TestEndpointTypes>({
    name: 'TEST',
    inputParameters: {
      from: {
        type: 'string',
        required: true,
      },
      to: {
        type: 'string',
        required: true,
      },
    },
    transport: restEndpointTransport,
  })
}
