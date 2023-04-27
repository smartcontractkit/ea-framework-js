import untypedTest, { ExecutionContext, TestFn } from 'ava'
import { start } from '../src'
import {
  AdapterEndpoint,
  CryptoPriceEndpoint,
  IncludesFile,
  PriceAdapter,
  PriceEndpoint,
  PriceEndpointInputParameters,
  priceEndpointInputParametersDefinition,
} from '../src/adapter'
import { ResponseCache } from '../src/cache/response'
import { EmptyCustomSettings } from '../src/config'
import { HttpTransport, Transport } from '../src/transports'
import { AdapterRequest, AdapterResponse, SingleNumberResultResponse } from '../src/util'
import { InputParameters } from '../src/validation'
import { NopTransport, TestAdapter } from './util'

type TestContext = {
  testAdapter: TestAdapter
}
const test = untypedTest as TestFn<TestContext>

type PriceTestTypes = {
  Parameters: PriceEndpointInputParameters
  Response: {
    Data: { result: number }
    Result: number
  }
  Settings: EmptyCustomSettings
}

class PriceTestTransport implements Transport<PriceTestTypes> {
  name!: string
  responseCache!: ResponseCache<PriceTestTypes>

  constructor(
    private mockResponse: (
      req: AdapterRequest<PriceEndpointInputParameters>,
    ) => AdapterResponse<PriceTestTypes['Response']>,
  ) {}

  async initialize(): Promise<void> {
    return
  }

  async foregroundExecute(
    req: AdapterRequest<PriceEndpointInputParameters>,
  ): Promise<void | AdapterResponse<PriceTestTypes['Response']>> {
    return this.mockResponse(req)
  }
}

const buildAdapter = async (
  context: ExecutionContext<TestContext>['context'],
  mockResponse: (
    req: AdapterRequest<PriceEndpointInputParameters>,
  ) => AdapterResponse<PriceTestTypes['Response']>,
  includes?: IncludesFile,
) => {
  const adapter = new PriceAdapter({
    name: 'TEST',
    endpoints: [
      new PriceEndpoint({
        name: 'test',
        inputParameters: new InputParameters(priceEndpointInputParametersDefinition),
        transport: new PriceTestTransport(mockResponse),
      }),
      new AdapterEndpoint({
        name: 'basicEndpoint',
        inputParameters: new InputParameters(priceEndpointInputParametersDefinition),
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
    data: {
      result: 1234,
    },
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
    data: {
      result: 1234,
    },
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
    data: {
      result: 1 / 1234,
    },
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
    data: {
      result: 1234,
    },
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

test('basic adapter endpoints bypass includes logic successfully', async (t) => {
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
    result: 1234,
    data: {
      result: 1234,
    },
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
    endpoint: 'basicEndpoint',
  })
  t.is(response.statusCode, 200)
  t.is(response.json().result, mockResponse.result)
})

test('crypto price endpoint has common aliases', async (t) => {
  const mockResponse: (
    req: AdapterRequest<PriceEndpointInputParameters>,
  ) => AdapterResponse<PriceTestTypes['Response']> = () =>
    ({
      result: 1234,
      data: {
        result: 1234,
      },
      statusCode: 200,
      timestamps: {
        providerDataRequestedUnixMs: 0,
        providerDataReceivedUnixMs: 0,
        providerIndicatedTimeUnixMs: undefined,
      },
    } as AdapterResponse<PriceTestTypes['Response']>)

  const data = {
    base: 'BTC',
    quote: 'ETH',
  }

  const adapter = new PriceAdapter({
    name: 'TEST',
    endpoints: [
      new CryptoPriceEndpoint({
        name: 'test',
        inputParameters: new InputParameters(priceEndpointInputParametersDefinition),
        transport: new PriceTestTransport(mockResponse),
      }) as AdapterEndpoint<PriceTestTypes>,
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
  const mockResponse: (
    req: AdapterRequest<PriceEndpointInputParameters>,
  ) => AdapterResponse<PriceTestTypes['Response']> = () =>
    ({
      result: 1234,
      data: {
        result: 1234,
      },
      statusCode: 200,
      timestamps: {
        providerDataRequestedUnixMs: 0,
        providerDataReceivedUnixMs: 0,
        providerIndicatedTimeUnixMs: undefined,
      },
    } as AdapterResponse<PriceTestTypes['Response']>)

  const adapter = new PriceAdapter({
    name: 'TEST',
    endpoints: [
      new CryptoPriceEndpoint({
        name: 'test',
        inputParameters: new InputParameters(priceEndpointInputParametersDefinition),
        transport: new PriceTestTransport(mockResponse),
      }),
      new AdapterEndpoint({
        name: 'price',
        inputParameters: new InputParameters(priceEndpointInputParametersDefinition),
        transport: new NopTransport<PriceTestTypes>(),
      }),
    ],
  })

  const error: Error | undefined = await t.throwsAsync(() => start(adapter))
  t.is(error?.message, 'Duplicate endpoint / alias: "price"')
})

// This test is here only to check for type safety
test('can create a price adapter with only a single ', async (t) => {
  const mockResponse: (
    req: AdapterRequest<PriceEndpointInputParameters>,
  ) => AdapterResponse<PriceTestTypes['Response']> = () =>
    ({
      result: 1234,
      data: {
        result: 1234,
      },
      statusCode: 200,
      timestamps: {
        providerDataRequestedUnixMs: 0,
        providerDataReceivedUnixMs: 0,
        providerIndicatedTimeUnixMs: undefined,
      },
    } as AdapterResponse<PriceTestTypes['Response']>)

  const adapter = new PriceAdapter({
    name: 'TEST',
    endpoints: [
      new CryptoPriceEndpoint({
        name: 'test',
        inputParameters: new InputParameters(priceEndpointInputParametersDefinition),
        transport: new PriceTestTransport(mockResponse),
      }),
    ],
  })

  t.truthy(adapter)
})

test('can create a price endpoint with non-required base and quote', async (t) => {
  const parametersDefinition = {
    base: {
      aliases: ['from', 'coin'],
      type: 'string',
      description: 'The symbol of symbols of the currency to query',
      required: false,
    },
    quote: {
      aliases: ['to', 'market'],
      type: 'string',
      description: 'The symbol of the currency to convert to',
      required: true,
    },
  } as const

  const testInputParameters = new InputParameters(parametersDefinition)

  type TestTypes = {
    Parameters: typeof testInputParameters.definition
    Settings: EmptyCustomSettings
    Response: SingleNumberResultResponse
    Provider: {
      RequestBody: unknown
      ResponseBody: unknown
    }
  }

  const transport = new HttpTransport<TestTypes>({
    prepareRequests: (params) => {
      return {
        params,
        request: {
          url: '/price',
          method: 'POST',
          data: {
            pairs: params.map((p) => ({ base: p.base, quote: p.quote })),
          },
        },
      }
    },
    parseResponse: (params) => {
      return [
        {
          params: params[0],
          response: {
            statusCode: 400,
            errorMessage: 'asd',
          },
        },
      ]
    },
  })

  const endpoint = new PriceEndpoint<TestTypes>({
    name: 'test',
    inputParameters: testInputParameters,
    transport,
  })

  const adapter = new PriceAdapter({
    name: 'TEST',
    endpoints: [
      endpoint,
      new AdapterEndpoint({
        name: 'price',
        inputParameters: new InputParameters(priceEndpointInputParametersDefinition),
        transport: new NopTransport<PriceTestTypes>(),
      }),
    ],
  })

  t.truthy(adapter)
})
