import untypedTest, { ExecutionContext, TestFn } from 'ava'
import { start } from '../src'
import {
  AdapterEndpoint,
  CryptoPriceEndpoint,
  IncludesFile,
  PriceAdapter,
  PriceEndpoint,
  priceEndpointInputParameters,
} from '../src/adapter'
import { ResponseCache } from '../src/cache/response'
import { BaseAdapterConfig } from '../src/config'
import { Transport } from '../src/transports'
import { AdapterRequest, AdapterResponse } from '../src/util'
import { NopTransport, TestAdapter } from './util'

type TestContext = {
  testAdapter: TestAdapter
}
const test = untypedTest as TestFn<TestContext>

type PriceTestTypes = {
  Request: {
    Params: unknown
  }
  Response: {
    Data: null
    Result: number
  }
  Config: BaseAdapterConfig
}

class PriceTestTransport implements Transport<PriceTestTypes> {
  name!: string
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
  context: ExecutionContext<TestContext>['context'],
  mockResponse: (req: AdapterRequest) => AdapterResponse<PriceTestTypes['Response']>,
  includes?: IncludesFile,
) => {
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

  context.testAdapter = await TestAdapter.start(adapter, context)
  return context.testAdapter
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

  const testAdapter = await buildAdapter(t.context, (req) => {
    t.deepEqual(req.requestContext.data, data)

    return mockResponse
  })

  const response = await testAdapter.request({
    ...data,
    endpoint: 'test',
  })
  t.is(response.statusCode, 200)
  t.is(response.json().result, mockResponse.result)
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

  const testAdapter = await buildAdapter(
    t.context,
    (req) => {
      t.deepEqual(req.requestContext.data, data)

      return mockResponse
    },
    includes,
  )

  const response = await testAdapter.request({
    ...data,
    endpoint: 'test',
  })
  t.is(response.statusCode, 200)
  t.is(response.json().result, mockResponse.result)
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

  const testAdapter = await buildAdapter(
    t.context,
    (req) => {
      t.deepEqual(req.requestContext.data, {
        base: 'BTC',
        quote: 'ETH',
      })

      return mockResponse
    },
    includes,
  )

  const response = await testAdapter.request({
    ...data,
    endpoint: 'test',
  })
  t.is(response.statusCode, 200)
  t.is(response.json().result, 1234)
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

  const testAdapter = await buildAdapter(
    t.context,
    (req) => {
      t.deepEqual(req.requestContext.data, {
        base: 'BTC',
        quote: 'ETH',
      })

      return mockResponse
    },
    includes,
  )

  const response = await testAdapter.request({
    ...data,
    endpoint: 'test',
  })
  t.is(response.statusCode, 200)
  t.is(response.json().result, 1 / 1234)
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

  const testAdapter = await TestAdapter.start(adapter, t.context)

  for (const endpoint of ['price', 'crypto']) {
    const response = await testAdapter.request({ ...data, endpoint })
    t.is(response.statusCode, 200)
    t.is(response.json().result, 1234)
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

  const error: Error | undefined = await t.throwsAsync(() => start(adapter))
  t.is(error?.message, 'Duplicate endpoint / alias: "price"')
})
