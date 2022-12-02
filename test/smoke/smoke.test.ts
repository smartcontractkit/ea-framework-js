import untypedTest, { TestFn } from 'ava'
import axios, { AxiosError, AxiosRequestConfig, AxiosResponse } from 'axios'
import { AddressInfo } from 'net'
import nock from 'nock'
import { expose } from '../../src'
import { Adapter, AdapterEndpoint } from '../../src/adapter'
import { SettingsMap } from '../../src/config'
import { RestTransport } from '../../src/transports'
import { loadTestPayload, resolvePayload } from '../../src/util/test-payload-loader'

const test = untypedTest as TestFn

const URL = 'http://test-url.com'
const endpoint = '/price'

interface AdapterRequestParams {
  from: string
  to: string
}

interface ProviderRequestBody {
  base: string
  quote: string
}

interface ProviderResponseBody {
  price: number
}

type RestEndpointTypes = {
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

const createAdapterEndpoint = (): AdapterEndpoint<RestEndpointTypes> => {
  const restEndpointTransport = new RestTransport<RestEndpointTypes>({
    prepareRequest: (req): AxiosRequestConfig<ProviderRequestBody> => {
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
        data: res.data,
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

  return new AdapterEndpoint({
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

test.before(async () => {
  nock.disableNetConnect()
  nock.enableNetConnect('localhost')
})

test.after(() => {
  nock.restore()
})

const base = 'ETH'
const quote = 'USD'
const price = 1234

const startAdapter = async (): Promise<string> => {
  const adapter = new Adapter({
    name: 'TEST',
    defaultEndpoint: 'test',
    endpoints: [createAdapterEndpoint()],
  })

  const api = await expose(adapter)
  if (!api) {
    throw 'Server did not start'
  }
  return `http://localhost:${(api?.server.address() as AddressInfo)?.port}`
}

const jsPayload = {
  requests: [
    {
      from: 'ETH',
      to: 'USD',
    },
    {
      from: 'ETH',
      to: 'JPY',
    },
    {
      from: 'BTC',
      to: 'USD',
    },
    {
      from: 'BTC',
      to: 'JPY',
    },
  ],
}

test('Test payload resolver (json)', async (t) => {
  const payload = resolvePayload('test/smoke/test-payload.json')
  t.deepEqual(payload, {
    requests: [
      {
        from: 'ETH',
        to: 'USD',
      },
    ],
  })
})

test('Test payload resolver (js)', async (t) => {
  const payload = resolvePayload('test/smoke/test-payload.js')
  t.deepEqual(payload, jsPayload)
})

test('Test payload resolver (bad path)', async (t) => {
  const payload = resolvePayload('test/smoke/test-payload-fake.json')
  t.deepEqual(payload, null)
})

test('Test payload loader static', async (t) => {
  const testPayload = loadTestPayload('test/smoke/test-payload.json')
  if (testPayload.isDefault) {
    t.fail('Test payload loader return isDefault request unexpectedly')
    return
  }
  t.deepEqual(testPayload.requests[0], { from: base, to: quote })
})

test('Test payload loader dynamic', async (t) => {
  const testPayload = loadTestPayload('test/smoke/test-payload.js')
  if (testPayload.isDefault) {
    t.fail('Test payload loader return isDefault request unexpectedly')
    return
  }
  t.deepEqual(testPayload.requests[0], { from: 'ETH', to: 'USD' })
  t.deepEqual(testPayload.requests[1], { from: 'ETH', to: 'JPY' })
  t.deepEqual(testPayload.requests[2], { from: 'BTC', to: 'USD' })
  t.deepEqual(testPayload.requests[3], { from: 'BTC', to: 'JPY' })
})

test('Test payload loader bad file name', async (t) => {
  const testPayload = loadTestPayload('test/smoke/test-payload-bad.json')
  t.is(testPayload.isDefault, true)
})

test.serial('Test smoke endpoint success', async (t) => {
  process.env['SMOKE_TEST_PAYLOAD_FILE_NAME'] = 'test/smoke/test-payload.json'
  const address = await startAdapter()
  const instance = nock(URL)
    .get(endpoint)
    .query({
      base,
      quote,
    })
    .reply(200, { price })
  let response: AxiosResponse
  try {
    response = await axios.get(`${address}/smoke`)
  } catch (e: unknown) {
    t.fail('Smoke endpoint errored unexpectedly')
    return
  }
  t.is(response.data, 'OK')
  instance.done()
})

test.serial('Test smoke endpoint failure', async (t) => {
  process.env['SMOKE_TEST_PAYLOAD_FILE_NAME'] = 'test/smoke/test-payload-fail.json'
  const address = await startAdapter()
  try {
    await axios.get(`${address}/smoke`)
  } catch (e: unknown) {
    t.is((e as AxiosError).response?.status, 500)
    return
  }
  t.fail('Smoke endpoint passed unexpectedly')
})
