import untypedTest, { ExecutionContext, TestFn } from 'ava'
import { start } from '../src'
import {
  AdapterEndpoint,
  CryptoPriceEndpoint,
  EndpointContext,
  ForexPriceEndpoint,
  IncludesFile,
  PriceAdapter,
  PriceEndpoint,
  PriceEndpointInputParametersDefinition,
  RequestTransform,
  priceEndpointInputParametersDefinition,
} from '../src/adapter'
import { ResponseCache } from '../src/cache/response'
import { AdapterConfig, BaseAdapterSettings, EmptyCustomSettings } from '../src/config'
import { HttpTransport, Transport } from '../src/transports'
import { SubscriptionTransport } from '../src/transports/abstract/subscription'
import {
  AdapterRequest,
  AdapterRequestContext,
  AdapterResponse,
  SingleNumberResultResponse,
  TimestampedProviderResult,
} from '../src/util'
import { InputParameters } from '../src/validation'
import { TypeFromDefinition } from '../src/validation/input-params'
import { MockCache, NopTransport, TestAdapter } from '../src/util/testing-utils'

type TestContext = {
  testAdapter: TestAdapter
}
const test = untypedTest as TestFn<TestContext>

type PriceTestTypes = {
  Parameters: PriceEndpointInputParametersDefinition
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
      req: AdapterRequest<TypeFromDefinition<PriceEndpointInputParametersDefinition>>,
    ) => AdapterResponse<PriceTestTypes['Response']>,
  ) {}

  async initialize(): Promise<void> {
    return
  }

  async foregroundExecute(
    req: AdapterRequest<TypeFromDefinition<PriceEndpointInputParametersDefinition>>,
  ): Promise<void | AdapterResponse<PriceTestTypes['Response']>> {
    return this.mockResponse(req)
  }
}

const buildAdapter = async (
  context: ExecutionContext<TestContext>['context'],
  mockResponse: (
    req: AdapterRequest<TypeFromDefinition<PriceEndpointInputParametersDefinition>>,
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

type PriceTestParams = TypeFromDefinition<PriceEndpointInputParametersDefinition>

/** Answers from the response cache, so inverse pairs get their `-inverse` entry written. */
class PriceCacheTestTransport extends SubscriptionTransport<PriceTestTypes> {
  providerEntries: PriceTestParams[] = []
  requestContexts: AdapterRequestContext<PriceTestParams>[] = []

  constructor(private providerResponse: TimestampedProviderResult<PriceTestTypes>['response']) {
    super()
  }

  override async registerRequest(
    req: AdapterRequest<PriceTestParams>,
    settings: EmptyCustomSettings,
  ): Promise<void> {
    this.requestContexts.push({ ...req.requestContext })
    await super.registerRequest(req, settings)
  }

  getSubscriptionTtlFromConfig(): number {
    return 60_000
  }

  async backgroundHandler(
    _context: EndpointContext<PriceTestTypes>,
    entries: PriceTestParams[],
  ): Promise<void> {
    this.providerEntries = entries
    await this.responseCache.write(
      this.name,
      entries.map((entry) => ({ params: entry, response: this.providerResponse })),
    )
  }
}

const providerResponse = (
  data: PriceTestTypes['Response']['Data'],
  result: number,
): TimestampedProviderResult<PriceTestTypes>['response'] => ({
  data,
  result,
  timestamps: {
    providerDataRequestedUnixMs: 0,
    providerDataReceivedUnixMs: 0,
    providerIndicatedTimeUnixMs: undefined,
  },
})

const cachePollingConfig = {
  CACHE_POLLING_MAX_RETRIES: 20,
  CACHE_POLLING_SLEEP_MS: 10,
}

const buildCachedAdapter = async (
  context: ExecutionContext<TestContext>['context'],
  transport: SubscriptionTransport<PriceTestTypes>,
  options: {
    includes?: IncludesFile
    envDefaultOverrides?: Partial<BaseAdapterSettings>
    overrides?: Record<string, string>
    requestTransforms?: RequestTransform<PriceTestTypes>[]
  } = {},
): Promise<TestAdapter & { mockCache: MockCache }> =>
  TestAdapter.startWithMockedCache(
    new PriceAdapter({
      name: 'TEST',
      endpoints: [
        new PriceEndpoint({
          name: 'test',
          inputParameters: new InputParameters(priceEndpointInputParametersDefinition),
          transport,
          ...(options.overrides ? { overrides: options.overrides } : {}),
          ...(options.requestTransforms ? { requestTransforms: options.requestTransforms } : {}),
        }),
      ],
      ...(options.includes ? { includes: options.includes } : {}),
      config: new AdapterConfig(
        {},
        {
          envDefaultOverrides: {
            ...cachePollingConfig,
            ...(options.envDefaultOverrides ?? {}),
          },
        },
      ),
    }),
    context,
  )

const includesInverse = [
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

const cachePrefix = 'TEST-test-default_single_transport-'
const rawKeyOfPair = (base: string, quote: string) =>
  `${cachePrefix}{"base":"${base}","quote":"${quote}"}`

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
  const transport = new PriceCacheTestTransport(providerResponse({ result: 1 / 1234 }, 1 / 1234))
  const testAdapter = await buildCachedAdapter(t.context, transport, { includes: includesInverse })

  const response = await testAdapter.request({
    base: 'ETH',
    quote: 'BTC',
    endpoint: 'test',
  })

  t.is(response.statusCode, 200)
  t.is(response.json().result, 1234)
  t.is(response.json().data.result, 1234)

  t.deepEqual(transport.providerEntries, [{ base: 'BTC', quote: 'ETH' }])

  await testAdapter.api.close()
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

test('inverting request does not affect cached response', async (t) => {
  const transport = new PriceCacheTestTransport(providerResponse({ result: 1 / 1234 }, 1 / 1234))
  const testAdapter = await buildCachedAdapter(t.context, transport, { includes: includesInverse })

  // Direct request for the pair the provider supports: the raw entry.
  const invertedResponse = await testAdapter.request({
    base: 'BTC',
    quote: 'ETH',
    endpoint: 'test',
  })

  t.is(invertedResponse.statusCode, 200)
  t.is(invertedResponse.json().result, 1 / 1234)
  t.is(invertedResponse.json().data.result, 1 / 1234)

  // Includes-inverse request for the same pair: served from the `-inverse` entry.
  const response = await testAdapter.request({
    base: 'ETH',
    quote: 'BTC',
    endpoint: 'test',
  })

  t.is(response.statusCode, 200)
  t.is(response.json().result, 1234)
  t.is(response.json().data.result, 1234)

  const rawCached = await testAdapter.mockCache.get(rawKeyOfPair('btc', 'eth'))
  t.is((rawCached as { result: number }).result, 1 / 1234)

  await testAdapter.api.close()
})

test('explicitly disabled inversion is a no-op and preserves includes behavior', async (t) => {
  const transport = new PriceCacheTestTransport(providerResponse({ result: 2 }, 2))
  const testAdapter = await buildCachedAdapter(t.context, transport, { includes: includesInverse })

  const response = await testAdapter.request({
    base: 'ETH',
    quote: 'BTC',
    endpoint: 'test',
    inversion: false,
  })

  t.is(response.statusCode, 200)
  t.is(response.json().result, 0.5)
  t.is(response.json().data.result, 0.5)

  // `inversion: false` behaves exactly like an absent field: includes still asks for the inverse.
  const rawKey = rawKeyOfPair('btc', 'eth')
  const [context] = transport.requestContexts
  t.is(context.rawCacheKey, rawKey)
  t.is(context.cacheKey, `${rawKey}-inverse`)

  await testAdapter.api.close()
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
    req: AdapterRequest<TypeFromDefinition<PriceEndpointInputParametersDefinition>>,
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
    }) as AdapterResponse<PriceTestTypes['Response']>

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
    req: AdapterRequest<TypeFromDefinition<PriceEndpointInputParametersDefinition>>,
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
    }) as AdapterResponse<PriceTestTypes['Response']>

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
    req: AdapterRequest<TypeFromDefinition<PriceEndpointInputParametersDefinition>>,
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
    }) as AdapterResponse<PriceTestTypes['Response']>

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

test('can create a crypto price endpoint with non-required base and quote and extra properties', async (t) => {
  const parametersDefinition = {
    index: {
      description: 'The ID of the index. Takes priority over base/quote when provided.',
      type: 'string',
      required: false,
    },
    base: {
      aliases: ['from', 'coin'],
      type: 'string',
      description: 'The symbol of symbols of the currency to query',
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
            pairs: params.map((p) => ({ base: p.base, quote: p.quote, index: p.index })),
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

  const endpoint = new CryptoPriceEndpoint<TestTypes>({
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

test('does not process request if endpoint not supported in includes', async (t) => {
  const includes = [
    {
      from: 'ETH',
      to: 'USD',
      includes: [
        {
          from: 'USD',
          to: 'ETH',
          inverse: true,
          endpoints: ['forex'],
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
    quote: 'USD',
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
  t.is(response.statusCode, 500)
  t.is(response.body, 'Endpoint test not supported for ETH/USD in includes.json')
})

test('processes request if endpoint supported in includes', async (t) => {
  const includes = [
    {
      from: 'ETH',
      to: 'BTC',
      includes: [
        {
          from: 'BTC',
          to: 'ETH',
          inverse: true,
          endpoints: ['test'],
        },
      ],
    },
  ]

  const transport = new PriceCacheTestTransport(providerResponse({ result: 1 / 1234 }, 1 / 1234))
  const testAdapter = await buildCachedAdapter(t.context, transport, { includes })

  const response = await testAdapter.request({
    base: 'ETH',
    quote: 'BTC',
    endpoint: 'test',
  })

  t.is(response.statusCode, 200)
  t.is(response.json().result, 1234)
  t.is(response.json().data.result, 1234)
  t.deepEqual(transport.providerEntries, [{ base: 'BTC', quote: 'ETH' }])

  await testAdapter.api.close()
})

test.serial(
  'a plain PriceEndpoint serves includes-inverse pairs from the inverse cache entry',
  async (t) => {
    const transport = new PriceCacheTestTransport(providerResponse({ result: 4 }, 4))
    const testAdapter = await buildCachedAdapter(t.context, transport, {
      includes: includesInverse,
    })

    const response = await testAdapter.request({
      base: 'ETH',
      quote: 'BTC',
      endpoint: 'test',
    })

    t.is(response.statusCode, 200)
    t.is(response.json().result, 0.25)
    t.is(response.json().data.result, 0.25)

    // The provider is only ever asked for the rewritten pair.
    t.deepEqual(transport.providerEntries, [{ base: 'BTC', quote: 'ETH' }])

    const rawKey = rawKeyOfPair('btc', 'eth')
    const [context] = transport.requestContexts
    t.is(context.rawCacheKey, rawKey)
    t.is(context.cacheKey, `${rawKey}-inverse`)
    t.false('swappedPair' in context)
    t.false('priceMeta' in context)

    const rawCached = await testAdapter.mockCache.get(rawKey)
    const inverseCached = await testAdapter.mockCache.get(`${rawKey}-inverse`)
    t.is((rawCached as { result: number }).result, 4)
    t.is((inverseCached as { result: number }).result, 0.25)

    await testAdapter.api.close()
  },
)

test.serial('the inverse of data without a result field keeps the raw data shape', async (t) => {
  const dataWithoutResult = { price: 5 } as unknown as PriceTestTypes['Response']['Data']
  const transport = new PriceCacheTestTransport(providerResponse(dataWithoutResult, 5))
  const testAdapter = await buildCachedAdapter(t.context, transport, { includes: includesInverse })

  const response = await testAdapter.request({
    base: 'ETH',
    quote: 'BTC',
    endpoint: 'test',
  })

  t.is(response.statusCode, 200)
  t.is(response.json().result, 0.2)

  const rawKey = rawKeyOfPair('btc', 'eth')
  const rawCached = (await testAdapter.mockCache.get(rawKey)) as { data: Record<string, unknown> }
  const inverseCached = (await testAdapter.mockCache.get(`${rawKey}-inverse`)) as {
    data: Record<string, unknown>
    result: number
  }

  t.is(inverseCached.result, 0.2)
  t.false('result' in inverseCached.data)
  t.deepEqual(Object.keys(inverseCached.data), Object.keys(rawCached.data))
  t.deepEqual(inverseCached.data, rawCached.data)

  await testAdapter.api.close()
})

test.serial('inversion: true on an includes-inverse pair returns the inverse', async (t) => {
  const transport = new PriceCacheTestTransport(providerResponse({ result: 4 }, 4))
  const testAdapter = await TestAdapter.startWithMockedCache(
    new PriceAdapter({
      name: 'TEST',
      endpoints: [
        new ForexPriceEndpoint({
          name: 'test',
          inputParameters: new InputParameters(priceEndpointInputParametersDefinition),
          transport,
        }),
      ],
      includes: includesInverse,
      config: new AdapterConfig({}, { envDefaultOverrides: cachePollingConfig }),
    }),
    t.context,
  )

  const response = await testAdapter.request({
    base: 'ETH',
    quote: 'BTC',
    endpoint: 'test',
    inversion: true,
  })

  t.is(response.statusCode, 200)
  t.is(response.json().result, 0.25)

  // The flag is the same as not sending it: the inverse is served from the inverse entry.
  const rawKey = rawKeyOfPair('btc', 'eth')
  const [context] = transport.requestContexts
  t.is(context.cacheKey, `${rawKey}-inverse`)
  t.is(context.rawCacheKey, rawKey)
  t.is(((await testAdapter.mockCache.get(`${rawKey}-inverse`)) as { result: number }).result, 0.25)

  await testAdapter.api.close()
})

test.serial('an includes entry that does not invert serves the raw value', async (t) => {
  const includes = [
    {
      from: 'ETH',
      to: 'BTC',
      includes: [
        {
          from: 'BTC',
          to: 'ETH',
          inverse: false,
        },
      ],
    },
  ]
  const transport = new PriceCacheTestTransport(providerResponse({ result: 4 }, 4))
  const testAdapter = await buildCachedAdapter(t.context, transport, { includes })

  const response = await testAdapter.request({
    base: 'ETH',
    quote: 'BTC',
    endpoint: 'test',
  })

  t.is(response.statusCode, 200)
  t.is(response.json().result, 4)
  t.is(response.json().data.result, 4)

  const rawKey = rawKeyOfPair('btc', 'eth')
  const [context] = transport.requestContexts
  t.is(context.cacheKey, rawKey)
  t.is(await testAdapter.mockCache.get(`${rawKey}-inverse`), undefined)

  await testAdapter.api.close()
})

const foregroundResponse = (): AdapterResponse<PriceTestTypes['Response']> => ({
  result: 4,
  data: { result: 4 },
  statusCode: 200,
  timestamps: {
    providerDataRequestedUnixMs: 0,
    providerDataReceivedUnixMs: 0,
    providerIndicatedTimeUnixMs: undefined,
  },
})

test.serial('an includes-inverse request on a foreground transport returns 400', async (t) => {
  const adapter = new PriceAdapter({
    name: 'TEST',
    endpoints: [
      new PriceEndpoint({
        name: 'test',
        inputParameters: new InputParameters(priceEndpointInputParametersDefinition),
        transport: new PriceTestTransport(foregroundResponse),
      }),
    ],
    includes: includesInverse,
  })
  const testAdapter = await TestAdapter.start(adapter, t.context)

  try {
    const inverse = await testAdapter.request({ base: 'ETH', quote: 'BTC', endpoint: 'test' })
    t.is(inverse.statusCode, 400)
    t.true(inverse.body.includes('does not support inversion'))
    t.true(inverse.body.includes('default_single_transport'))

    // A pair that includes does not invert still works.
    const raw = await testAdapter.request({ base: 'LINK', quote: 'USD', endpoint: 'test' })
    t.is(raw.statusCode, 200)
    t.is(raw.json().result, 4)
  } finally {
    await testAdapter.api.close()
  }
})

test.serial(
  'an includes-inverse request on an endpoint with a custom cacheKeyGenerator returns 400',
  async (t) => {
    const adapter = new PriceAdapter({
      name: 'TEST',
      endpoints: [
        new PriceEndpoint({
          name: 'test',
          inputParameters: new InputParameters(priceEndpointInputParametersDefinition),
          transport: new PriceTestTransport(foregroundResponse),
          cacheKeyGenerator: () => 'custom-key',
        }),
      ],
      includes: includesInverse,
    })
    const testAdapter = await TestAdapter.start(adapter, t.context)

    try {
      const inverse = await testAdapter.request({ base: 'ETH', quote: 'BTC', endpoint: 'test' })
      t.is(inverse.statusCode, 400)
      t.true(
        inverse.body.includes(
          'cannot use inversion with a custom cacheKeyGenerator: keys may not distinguish variants',
        ),
      )

      // A pair that includes does not invert still works.
      const raw = await testAdapter.request({ base: 'LINK', quote: 'USD', endpoint: 'test' })
      t.is(raw.statusCode, 200)
      t.is(raw.json().result, 4)
    } finally {
      await testAdapter.api.close()
    }
  },
)

test.serial(
  'a plain PriceEndpoint in an adapter with includes still rejects inversion: true',
  async (t) => {
    const transport = new PriceCacheTestTransport(providerResponse({ result: 4 }, 4))
    const testAdapter = await buildCachedAdapter(t.context, transport, {
      includes: includesInverse,
    })

    const response = await testAdapter.request({
      base: 'BTC',
      quote: 'ETH',
      endpoint: 'test',
      inversion: true,
    })

    t.is(response.statusCode, 400)
    t.true(response.body.includes('does not support inversion'))

    await testAdapter.api.close()
  },
)

test.serial('includes is looked up after overrides', async (t) => {
  const transport = new PriceCacheTestTransport(providerResponse({ result: 4 }, 4))
  const testAdapter = await buildCachedAdapter(t.context, transport, {
    includes: includesInverse,
    overrides: { ETH: 'WETH' },
  })

  const response = await testAdapter.request({
    base: 'ETH',
    quote: 'BTC',
    endpoint: 'test',
  })

  t.is(response.statusCode, 200)
  t.is(response.json().result, 4)
  // The lookup sees WETH/BTC, so includes does not match and the raw value is served.
  t.deepEqual(transport.providerEntries, [{ base: 'WETH', quote: 'BTC' }])

  await testAdapter.api.close()
})

test.serial('an override that produces an includes key matches', async (t) => {
  const transport = new PriceCacheTestTransport(providerResponse({ result: 4 }, 4))
  const testAdapter = await buildCachedAdapter(t.context, transport, {
    includes: includesInverse,
    overrides: { XETH: 'ETH' },
  })

  const response = await testAdapter.request({
    base: 'XETH',
    quote: 'BTC',
    endpoint: 'test',
  })

  t.is(response.statusCode, 200)
  t.is(response.json().result, 0.25)
  t.deepEqual(transport.providerEntries, [{ base: 'BTC', quote: 'ETH' }])

  await testAdapter.api.close()
})

test.serial("the adapter's own transform runs before includes", async (t) => {
  const seen: Record<string, unknown>[] = []
  const transport = new PriceCacheTestTransport(providerResponse({ result: 4 }, 4))
  const testAdapter = await buildCachedAdapter(t.context, transport, {
    includes: includesInverse,
    requestTransforms: [
      (req) => {
        seen.push({ ...(req.requestContext.data as Record<string, unknown>) })
      },
    ],
  })

  const response = await testAdapter.request({
    base: 'ETH',
    quote: 'BTC',
    endpoint: 'test',
  })

  t.is(response.statusCode, 200)
  t.deepEqual(seen, [{ base: 'ETH', quote: 'BTC' }])
  t.deepEqual(transport.providerEntries, [{ base: 'BTC', quote: 'ETH' }])

  await testAdapter.api.close()
})

test('invertsByDefault respects the endpoints filter', (t) => {
  const endpoint = new PriceEndpoint({
    name: 'test',
    inputParameters: new InputParameters(priceEndpointInputParametersDefinition),
    transport: new NopTransport<PriceTestTypes>(),
  })
  const adapter = new PriceAdapter({
    name: 'TEST',
    endpoints: [endpoint],
    includes: [
      {
        from: 'ETH',
        to: 'BTC',
        includes: [
          {
            from: 'BTC',
            to: 'ETH',
            inverse: true,
            endpoints: ['other'],
          },
        ],
      },
    ],
  })

  const hooked = adapter.endpoints[0]
  t.is(hooked.invertsByDefault?.({ base: 'ETH', quote: 'BTC' }), false)
  t.is(hooked.invertsByDefault?.({ base: 'ETH', quote: 'USD' }), false)
})

test('a PriceAdapter without includes sets no inversion hooks', (t) => {
  const endpoint = new PriceEndpoint({
    name: 'test',
    inputParameters: new InputParameters(priceEndpointInputParametersDefinition),
    transport: new NopTransport<PriceTestTypes>(),
  })
  const adapter = new PriceAdapter({ name: 'TEST', endpoints: [endpoint] })
  const plain = adapter.endpoints[0]

  t.is(plain.invertsByDefault, undefined)
  t.is(plain.pairRewrite, undefined)
  t.is(plain.invertResponse, undefined)
})

test('the includes rewrite is not part of requestTransforms', (t) => {
  const build = (includes?: IncludesFile) => {
    const endpoint = new PriceEndpoint({
      name: 'test',
      inputParameters: new InputParameters(priceEndpointInputParametersDefinition),
      transport: new NopTransport<PriceTestTypes>(),
    })
    const adapter = new PriceAdapter({
      name: 'TEST',
      endpoints: [endpoint],
      ...(includes ? { includes } : {}),
    })
    return adapter.endpoints[0]
  }

  t.is(build(includesInverse).requestTransforms.length, build().requestTransforms.length)
})
