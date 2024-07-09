import { NopTransport, TestAdapter } from '../src/util/testing-utils'
import untypedTest, { ExecutionContext, TestFn } from 'ava'
import { InputParameters } from '../src/validation'
import {
  DEFAULT_LWBA_ALIASES,
  IncludesFile,
  LwbaEndpoint,
  LwbaEndpointGenerics,
  LwbaEndpointInputParametersDefinition,
  LwbaResponseDataFields,
  PriceAdapter,
  PriceEndpoint,
  PriceEndpointInputParametersDefinition,
  lwbaEndpointInputParametersDefinition,
  priceEndpointInputParametersDefinition,
} from '../src/adapter'
import { AdapterRequest, AdapterResponse } from '../src/util'
import { EmptyCustomSettings } from '../src/config'
import { TypeFromDefinition } from '../src/validation/input-params'
import { Transport } from '../src/transports'
import { ResponseCache } from '../src/cache/response'

type TestContext = {
  testAdapter: TestAdapter
}
const test = untypedTest as TestFn<TestContext>

type LWBATestTypes = {
  Parameters: LwbaEndpointInputParametersDefinition
  Response: LwbaResponseDataFields
  Settings: EmptyCustomSettings
}

class LWBATestTransport implements Transport<LWBATestTypes> {
  name!: string
  responseCache!: ResponseCache<LWBATestTypes>

  constructor(
    private mockResponse: (
      req: AdapterRequest<TypeFromDefinition<LwbaEndpointInputParametersDefinition>>,
    ) => AdapterResponse<LWBATestTypes['Response']>,
  ) {
  }

  async initialize(): Promise<void> {
    return
  }

  async foregroundExecute(
    req: AdapterRequest<TypeFromDefinition<LwbaEndpointInputParametersDefinition>>,
  ): Promise<void | AdapterResponse<LWBATestTypes['Response']>> {

    return this.mockResponse(req)
  }
}

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
  async initialize(): Promise<void> {
    return
  }
}

export const buildAdapter = async (
  context: ExecutionContext<TestContext>['context'],
  mockResponse: (
    req: AdapterRequest<TypeFromDefinition<LwbaEndpointInputParametersDefinition>>,
  ) => AdapterResponse<LWBATestTypes['Response']>,
  includes?: IncludesFile,
) => {
  const adapter = new PriceAdapter({
    name: 'TEST',
    endpoints: [
      new PriceEndpoint({
        name: 'test',
        inputParameters: new InputParameters(priceEndpointInputParametersDefinition),
        transport: new PriceTestTransport(),
      }),
      new LwbaEndpoint({
        name: 'lwba_test',
        inputParameters: new InputParameters(lwbaEndpointInputParametersDefinition),
        transport: new LWBATestTransport(mockResponse),
      })
    ],
    includes,
  })

  context.testAdapter = await TestAdapter.start(adapter, context)
  return context.testAdapter
}

test('lwba price endpoint has common aliases', async (t) => {
  const lwbaEndpoint = new LwbaEndpoint({
    name: 'test',
    inputParameters: new InputParameters(lwbaEndpointInputParametersDefinition),
    transport: new NopTransport(),
  }) as LwbaEndpoint<LwbaEndpointGenerics>

  t.deepEqual(lwbaEndpoint.aliases, DEFAULT_LWBA_ALIASES)
})

test('Successful response passes LWBA validation', async (t) => {
  const mockResponse: AdapterResponse<LWBATestTypes['Response']> = {
    result: null,
    data: {
      bid: 123.1,
      mid: 123.2,
      ask: 123.3,
    },
    statusCode: 200,
    timestamps: {
      providerDataRequestedUnixMs: 0,
      providerDataReceivedUnixMs: 0,
      providerIndicatedTimeUnixMs: undefined,
    },
  }

  const testAdapter = await buildAdapter(
    t.context,
    (req) => {
      t.deepEqual(req.requestContext.data, {
        base: 'BTC',
        quote: 'USD',
      })

      return mockResponse
    },
  )

  const response = await testAdapter.request({
    base: 'BTC',
    quote: 'USD',
    endpoint: 'lwba_test',
  })

  t.is(response.statusCode, 200)
  t.is(response.json().data.bid, 123.1)
  t.is(response.json().data.mid, 123.2)
  t.is(response.json().data.ask, 123.3)
})

test('Invariant violation fails LWBA validation (bid <= mid <= ask)', async (t) => {
  const mockResponse: AdapterResponse<LWBATestTypes['Response']> = {
    result: null,
    data: {
      bid: 123.1,
      mid: 123.4,
      ask: 123.3,
    },
    statusCode: 200,
    timestamps: {
      providerDataRequestedUnixMs: 0,
      providerDataReceivedUnixMs: 0,
      providerIndicatedTimeUnixMs: undefined,
    },
  }

  const testAdapter = await buildAdapter(
    t.context,
    (req) => {
      t.deepEqual(req.requestContext.data, {
        base: 'BTC',
        quote: 'USD',
      })

      return mockResponse
    },
  )

  const expectedError = JSON.stringify({
    "status": "errored",
    "statusCode": 500,
    "error": {
      "name": "AdapterLWBAError",
      "message": "Invariant violation. Mid price must be between bid and ask prices. Got: (bid: 123.1, mid: 123.4, ask: 123.3)"
    }
  })

  const response = await testAdapter.request({
    base: 'BTC',
    quote: 'USD',
    endpoint: 'lwba_test',
  })

  t.is(response.statusCode, 500)
  t.is(JSON.stringify(response.json()), expectedError)
})


test('Invariant violation fails LWBA validation (bid, mid or ask not found)', async (t) => {
  const mockResponse: AdapterResponse<LWBATestTypes['Response']> = {
    result: null,
    data: {
      bid: null as never,
      mid: 123.4,
      ask: 123.3,
    },
    statusCode: 200,
    timestamps: {
      providerDataRequestedUnixMs: 0,
      providerDataReceivedUnixMs: 0,
      providerIndicatedTimeUnixMs: undefined,
    },
  }

  const testAdapter = await buildAdapter(
    t.context,
    (req) => {
      t.deepEqual(req.requestContext.data, {
        base: 'BTC',
        quote: 'USD',
      })

      return mockResponse
    },
  )

  const expectedError = JSON.stringify({
    "status": "errored",
    "statusCode": 500,
    "error": {
      "name": "AdapterLWBAError",
      "message": "Invariant violation. LWBA response must contain mid, bid and ask prices. Got: (bid: null, mid: 123.4, ask: 123.3)"
    }
  })

  const response = await testAdapter.request({
    base: 'BTC',
    quote: 'USD',
    endpoint: 'lwba_test',
  })

  t.is(response.statusCode, 500)
  t.is(JSON.stringify(response.json()), expectedError)
})