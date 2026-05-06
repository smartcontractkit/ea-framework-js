import untypedTest, { TestFn } from 'ava'
import { Adapter, AdapterEndpoint } from '../src/adapter'
import { AdapterConfig } from '../src/config'
import { ResponseCache } from '../src/cache/response'
import { Transport, TransportGenerics } from '../src/transports'
import { AdapterRequest } from '../src/util'
import { InputParameters } from '../src/validation'
import { TypeFromDefinition } from '../src/validation/input-params'
import { TestAdapter } from '../src/util/testing-utils'

type Pair = {
  base: string
  quote: string
}

const inputParameters = new InputParameters({
  base: {
    type: 'string',
    description: 'base',
    required: true,
  },
  quote: {
    type: 'string',
    description: 'quote',
    required: true,
  },
})

type TestTransportGenerics = TransportGenerics & {
  Parameters: typeof inputParameters.definition
  Response: {
    Data: Pair
  }
}

class EchoTransport implements Transport<TestTransportGenerics> {
  name!: string
  responseCache!: ResponseCache<TestTransportGenerics>
  async initialize() {
    return
  }
  async foregroundExecute(
    req: AdapterRequest<TypeFromDefinition<TestTransportGenerics['Parameters']>>,
  ) {
    return {
      data: {
        base: req.requestContext.data.base,
        quote: req.requestContext.data.quote,
      },
      statusCode: 200,
      result: null,
      timestamps: {
        providerDataRequestedUnixMs: 0,
        providerDataReceivedUnixMs: 0,
        providerIndicatedTimeUnixMs: undefined,
      },
    }
  }
}

const test = untypedTest as TestFn<{
  testAdapter: TestAdapter
}>

test.afterEach(() => {
  delete process.env['NORMALIZE_CASE_INPUTS']
})

test.serial('normalizes base and quote to uppercase by default', async (t) => {
  const adapter = new Adapter({
    name: 'TEST',
    defaultEndpoint: 'test',
    endpoints: [
      new AdapterEndpoint({
        name: 'test',
        inputParameters,
        transport: new EchoTransport(),
      }),
    ],
  })

  const testAdapter = await TestAdapter.start(adapter, t.context)
  const response = await testAdapter.request({
    base: 'USDe',
    quote: 'usd',
  })

  t.is(response.statusCode, 200)
  t.deepEqual(response.json().data, {
    base: 'USDE',
    quote: 'USD',
  })
})

test.serial('mixed-case requests for same asset resolve to same response', async (t) => {
  const adapter = new Adapter({
    name: 'TEST',
    defaultEndpoint: 'test',
    endpoints: [
      new AdapterEndpoint({
        name: 'test',
        inputParameters,
        transport: new EchoTransport(),
      }),
    ],
  })

  const testAdapter = await TestAdapter.start(adapter, t.context)

  const response1 = await testAdapter.request({ base: 'USDe', quote: 'USD' })
  const response2 = await testAdapter.request({ base: 'USDE', quote: 'USD' })
  const response3 = await testAdapter.request({ base: 'usde', quote: 'usd' })

  t.is(response1.statusCode, 200)
  t.is(response2.statusCode, 200)
  t.is(response3.statusCode, 200)

  t.deepEqual(response1.json().data, { base: 'USDE', quote: 'USD' })
  t.deepEqual(response2.json().data, { base: 'USDE', quote: 'USD' })
  t.deepEqual(response3.json().data, { base: 'USDE', quote: 'USD' })
})

test.serial('does not normalize when NORMALIZE_CASE_INPUTS is false', async (t) => {
  process.env['NORMALIZE_CASE_INPUTS'] = 'false'

  const adapter = new Adapter({
    name: 'TEST',
    defaultEndpoint: 'test',
    endpoints: [
      new AdapterEndpoint({
        name: 'test',
        inputParameters,
        transport: new EchoTransport(),
      }),
    ],
  })

  const testAdapter = await TestAdapter.start(adapter, t.context)
  const response = await testAdapter.request({
    base: 'USDe',
    quote: 'usd',
  })

  t.is(response.statusCode, 200)
  t.deepEqual(response.json().data, {
    base: 'USDe',
    quote: 'usd',
  })
})

test.serial('adapter can opt out via envDefaultOverrides', async (t) => {
  const adapter = new Adapter({
    name: 'TEST',
    defaultEndpoint: 'test',
    config: new AdapterConfig(
      {},
      {
        envDefaultOverrides: {
          NORMALIZE_CASE_INPUTS: false,
        },
      },
    ),
    endpoints: [
      new AdapterEndpoint({
        name: 'test',
        inputParameters,
        transport: new EchoTransport(),
      }),
    ],
  })

  const testAdapter = await TestAdapter.start(adapter, t.context)
  const response = await testAdapter.request({
    base: 'USDe',
    quote: 'usd',
  })

  t.is(response.statusCode, 200)
  t.deepEqual(response.json().data, {
    base: 'USDe',
    quote: 'usd',
  })
})

test.serial('normalization runs after symbolOverrider', async (t) => {
  const adapter = new Adapter({
    name: 'TEST',
    defaultEndpoint: 'test',
    endpoints: [
      new AdapterEndpoint({
        name: 'test',
        inputParameters,
        transport: new EchoTransport(),
        overrides: {
          WBTC: 'btc',
        },
      }),
    ],
  })

  const testAdapter = await TestAdapter.start(adapter, t.context)
  const response = await testAdapter.request({
    base: 'WBTC',
    quote: 'USD',
  })

  t.is(response.statusCode, 200)
  t.deepEqual(response.json().data, {
    base: 'BTC',
    quote: 'USD',
  })
})

test.serial('normalization does not affect non-base/quote string params', async (t) => {
  const extendedInputParameters = new InputParameters({
    base: {
      type: 'string',
      description: 'base',
      required: true,
    },
    quote: {
      type: 'string',
      description: 'quote',
      required: true,
    },
    market: {
      type: 'string',
      description: 'market identifier',
    },
  })

  type ExtendedGenerics = TransportGenerics & {
    Parameters: typeof extendedInputParameters.definition
    Response: {
      Data: { base: string; quote: string; market?: string }
    }
  }

  class ExtendedEchoTransport implements Transport<ExtendedGenerics> {
    name!: string
    responseCache!: ResponseCache<ExtendedGenerics>
    async initialize() {
      return
    }
    async foregroundExecute(
      req: AdapterRequest<TypeFromDefinition<ExtendedGenerics['Parameters']>>,
    ) {
      return {
        data: {
          base: req.requestContext.data.base,
          quote: req.requestContext.data.quote,
          market: req.requestContext.data.market,
        },
        statusCode: 200,
        result: null,
        timestamps: {
          providerDataRequestedUnixMs: 0,
          providerDataReceivedUnixMs: 0,
          providerIndicatedTimeUnixMs: undefined,
        },
      }
    }
  }

  const adapter = new Adapter({
    name: 'TEST',
    defaultEndpoint: 'test',
    endpoints: [
      new AdapterEndpoint({
        name: 'test',
        inputParameters: extendedInputParameters,
        transport: new ExtendedEchoTransport(),
      }),
    ],
  })

  const testAdapter = await TestAdapter.start(adapter, t.context)
  const response = await testAdapter.request({
    base: 'eth',
    quote: 'usd',
    market: 'nyse_arca',
  })

  t.is(response.statusCode, 200)
  const data = response.json().data
  t.is(data.base, 'ETH')
  t.is(data.quote, 'USD')
  t.is(data.market, 'nyse_arca')
})

test.serial('already uppercase inputs are unchanged', async (t) => {
  const adapter = new Adapter({
    name: 'TEST',
    defaultEndpoint: 'test',
    endpoints: [
      new AdapterEndpoint({
        name: 'test',
        inputParameters,
        transport: new EchoTransport(),
      }),
    ],
  })

  const testAdapter = await TestAdapter.start(adapter, t.context)
  const response = await testAdapter.request({
    base: 'ETH',
    quote: 'USD',
  })

  t.is(response.statusCode, 200)
  t.deepEqual(response.json().data, {
    base: 'ETH',
    quote: 'USD',
  })
})

test.serial('adapter-specific requestTransform runs after normalization', async (t) => {
  const adapter = new Adapter({
    name: 'TEST',
    defaultEndpoint: 'test',
    endpoints: [
      new AdapterEndpoint({
        name: 'test',
        inputParameters,
        transport: new EchoTransport(),
        requestTransforms: [
          (req) => {
            const data = req.requestContext.data as Record<string, string>
            data['base'] = data['base'].toLowerCase()
            data['quote'] = data['quote'].toLowerCase()
          },
        ],
      }),
    ],
  })

  const testAdapter = await TestAdapter.start(adapter, t.context)
  const response = await testAdapter.request({
    base: 'ETH',
    quote: 'USD',
  })

  t.is(response.statusCode, 200)
  t.deepEqual(response.json().data, {
    base: 'eth',
    quote: 'usd',
  })
})
