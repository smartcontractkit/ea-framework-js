import untypedTest, { TestFn } from 'ava'
import axios from 'axios'
import { AddressInfo } from 'net'
import { expose } from '../src'
import {
  AdapterEndpoint,
  CryptoPriceEndpoint,
  IncludesFile,
  PriceAdapter,
  PriceEndpoint,
  priceEndpointInputParameters,
} from '../src/adapter'
import { ResponseCache } from '../src/cache/response'
import { SettingsMap } from '../src/config'
import { Transport } from '../src/transports'
import { AdapterRequest, AdapterResponse, EmptyObject } from '../src/util'
import { NopTransport } from './util'

const test = untypedTest as TestFn

type PriceTestTypes = {
  Request: {
    Params: EmptyObject
  }
  Response: {
    Data: null
    Result: number
  }
  CustomSettings: SettingsMap
}

class PriceTestTransport implements Transport<PriceTestTypes> {
  responseCache!: ResponseCache<{
    Request: PriceTestTypes['Request']
    Response: PriceTestTypes['Response']
  }>

  constructor(
    private mockResponse: (req: AdapterRequest) => AdapterResponse<PriceTestTypes['Response']>,
  ) {}

  async initialize(): Promise<void> {
    return
  }

  async foregroundExecute(
    req: AdapterRequest<PriceTestTypes['Request']>,
  ): Promise<void | AdapterResponse<PriceTestTypes['Response']>> {
    return this.mockResponse(req)
  }
}

const buildAdapter = async (
  mockResponse: (req: AdapterRequest) => AdapterResponse<PriceTestTypes['Response']>,
  includes?: IncludesFile,
): Promise<string> => {
  const adapter = new PriceAdapter({
    name: 'TEST',
    endpoints: [
      new PriceEndpoint({
        name: 'test',
        inputParameters: priceEndpointInputParameters,
        transport: new PriceTestTransport(mockResponse),
      }),
    ],
    includes,
  })

  const api = await expose(adapter)
  if (!api) {
    throw 'Server did not start'
  }
  return `http://localhost:${(api.server.address() as AddressInfo).port}`
}

test('price adapter fails to start if no price endpoint is defined', async (t) => {
  await t.throws(
    () =>
      new PriceAdapter({
        name: 'TEST',
        endpoints: [
          new AdapterEndpoint({
            name: 'test',
            inputParameters: {},
            transport: new NopTransport(),
          }),
        ],
      }),
    {
      message: "This PriceAdapter's list of endpoints does not contain a valid PriceEndpoint",
    },
  )
})

test('does not invert result if no includes are present', async (t) => {
  const mockResponse: AdapterResponse<PriceTestTypes['Response']> = {
    result: 1234,
    data: null,
    statusCode: 200,
    timestamps: {
      providerDataRequestedUnixMs: 0,
      providerDataReceivedUnixMs: 0,
      providerIndicatedTimeUnixMs: undefined,
    },
  }

  const data = {
    base: 'ETH',
    quote: 'BTC',
  }

  const serverAddress = await buildAdapter((req) => {
    t.deepEqual(req.requestContext.data, data)

    return mockResponse
  })

  const response = await axios.post(serverAddress, {
    endpoint: 'test',
    data,
  })
  t.is(response.status, 200)
  t.is(response.data.result, mockResponse.result)
})

test('does not invert result if no includes match', async (t) => {
  const includes = [
    {
      from: 'ETH',
      to: 'USD',
      includes: [
        {
          from: 'USD',
          to: 'ETH',
          inverse: true,
        },
      ],
    },
  ]

  const mockResponse: AdapterResponse<PriceTestTypes['Response']> = {
    result: 1234,
    data: null,
    statusCode: 200,
    timestamps: {
      providerDataRequestedUnixMs: 0,
      providerDataReceivedUnixMs: 0,
      providerIndicatedTimeUnixMs: undefined,
    },
  }

  const data = {
    base: 'ETH',
    quote: 'BTC',
  }

  const serverAddress = await buildAdapter((req) => {
    t.deepEqual(req.requestContext.data, data)

    return mockResponse
  }, includes)

  const response = await axios.post(serverAddress, {
    endpoint: 'test',
    data,
  })
  t.is(response.status, 200)
  t.is(response.data.result, mockResponse.result)
})

test('inverts result if matching includes are present in request', async (t) => {
  const includes = [
    {
      from: 'ETH',
      to: 'BTC',
      includes: [
        {
          from: 'BTC',
          to: 'ETH',
          inverse: true,
        },
      ],
    },
  ]

  const mockResponse: AdapterResponse<PriceTestTypes['Response']> = {
    result: 1 / 1234,
    data: null,
    statusCode: 200,
    timestamps: {
      providerDataRequestedUnixMs: 0,
      providerDataReceivedUnixMs: 0,
      providerIndicatedTimeUnixMs: undefined,
    },
  }

  const data = {
    base: 'ETH',
    quote: 'BTC',
  }

  const serverAddress = await buildAdapter((req) => {
    t.deepEqual(req.requestContext.data, {
      base: 'BTC',
      quote: 'ETH',
    })

    return mockResponse
  }, includes)

  const response = await axios.post(serverAddress, {
    endpoint: 'test',
    data,
  })
  t.is(response.status, 200)
  t.is(response.data.result, 1234)
})

test('does not invert result if inverse pair sent directly', async (t) => {
  const includes = [
    {
      from: 'ETH',
      to: 'BTC',
      includes: [
        {
          from: 'BTC',
          to: 'ETH',
          inverse: true,
        },
      ],
    },
  ]

  const mockResponse: AdapterResponse<PriceTestTypes['Response']> = {
    result: 1 / 1234,
    data: null,
    statusCode: 200,
    timestamps: {
      providerDataRequestedUnixMs: 0,
      providerDataReceivedUnixMs: 0,
      providerIndicatedTimeUnixMs: undefined,
    },
  }

  const data = {
    base: 'BTC',
    quote: 'ETH',
  }

  const serverAddress = await buildAdapter((req) => {
    t.deepEqual(req.requestContext.data, {
      base: 'BTC',
      quote: 'ETH',
    })

    return mockResponse
  }, includes)

  const response = await axios.post(serverAddress, {
    endpoint: 'test',
    data,
  })
  t.is(response.status, 200)
  t.is(response.data.result, 1 / 1234)
})

test('crypto price endpoint has common aliases', async (t) => {
  const mockResponse: AdapterResponse<PriceTestTypes['Response']> = {
    result: 1234,
    data: null,
    statusCode: 200,
    timestamps: {
      providerDataRequestedUnixMs: 0,
      providerDataReceivedUnixMs: 0,
      providerIndicatedTimeUnixMs: undefined,
    },
  }

  const data = {
    base: 'BTC',
    quote: 'ETH',
  }

  const adapter = new PriceAdapter({
    name: 'TEST',
    endpoints: [
      new CryptoPriceEndpoint({
        name: 'test',
        inputParameters: priceEndpointInputParameters,
        transport: new PriceTestTransport(() => mockResponse),
      }),
    ],
  })

  const api = await expose(adapter)
  if (!api) {
    throw 'Server did not start'
  }
  const serverAddress = `http://localhost:${(api.server.address() as AddressInfo).port}`

  for (const endpoint of ['price', 'crypto']) {
    const response = await axios.post(serverAddress, {
      endpoint,
      data,
    })
    t.is(response.status, 200)
    t.is(response.data.result, 1234)
  }
})

test('price adapter throws if non-crypto endpoint reuses aliases', async (t) => {
  const mockResponse: AdapterResponse<PriceTestTypes['Response']> = {
    result: 1234,
    data: null,
    statusCode: 200,
    timestamps: {
      providerDataRequestedUnixMs: 0,
      providerDataReceivedUnixMs: 0,
      providerIndicatedTimeUnixMs: undefined,
    },
  }

  const adapter = new PriceAdapter({
    name: 'TEST',
    endpoints: [
      new CryptoPriceEndpoint({
        name: 'test',
        inputParameters: priceEndpointInputParameters,
        transport: new PriceTestTransport(() => mockResponse),
      }),
      new AdapterEndpoint({
        name: 'price',
        inputParameters: priceEndpointInputParameters,
        transport: new NopTransport(),
      }),
    ],
  })

  const error: Error | undefined = await t.throwsAsync(() => expose(adapter))
  t.is(error?.message, 'Duplicate endpoint / alias: "price"')
})
