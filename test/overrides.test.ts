import untypedTest, { TestFn } from 'ava'
import { Adapter, AdapterEndpoint, EndpointGenerics } from '../src/adapter'
import { ResponseCache } from '../src/cache/response'
import { Transport, TransportGenerics } from '../src/transports'
import { AdapterRequest } from '../src/util'
import { InputParameters } from '../src/validation'
import { TypeFromDefinition } from '../src/validation/input-params'
import { TestAdapter } from '../src/util/testing-utils'

const test = untypedTest as TestFn<{
  testAdapter: TestAdapter
  adapterEndpoint: AdapterEndpoint<EndpointGenerics>
}>

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
  adapterNameOverride: {
    type: 'string',
    description: 'adapterNameOverride',
  },
})

type TestTransportGenerics = TransportGenerics & {
  Parameters: typeof inputParameters.definition
  Response: {
    Data: Pair
  }
}

class OverrideTestTransport implements Transport<TestTransportGenerics> {
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

test.beforeEach(async (t) => {
  const adapter = new Adapter({
    name: 'TEST_ADAPTER',
    defaultEndpoint: 'test-endpoint',
    endpoints: [
      new AdapterEndpoint({
        name: 'test-endpoint',
        inputParameters,
        transport: new OverrideTestTransport(),
        overrides: {
          OVER1: 'overriden_1',
        },
      }),
    ],
  })

  t.context.adapterEndpoint = adapter.endpoints[0]
  t.context.testAdapter = await TestAdapter.start(adapter, t.context)
})

test('adapter hardcoded overrides are respected', async (t) => {
  const response = await t.context.testAdapter.request({
    base: 'OVER1',
    quote: 'USD',
  })

  t.deepEqual(response.json().data, {
    base: 'overriden_1',
    quote: 'USD',
  })
})

test('request overrides are respected', async (t) => {
  const response = await t.context.testAdapter.request({
    base: 'OVER2',
    quote: 'USD',
    overrides: {
      test_adapter: {
        OVER2: 'qweqwe',
      },
    },
  })

  t.deepEqual(response.json().data, {
    base: 'qweqwe',
    quote: 'USD',
  })
})

test('not overriden field is kept as is', async (t) => {
  const response = await t.context.testAdapter.request({
    base: 'NO-OVER',
    quote: 'USD',
    overrides: {
      test: {
        OVER2: 'qweqwe',
      },
    },
  })

  t.deepEqual(response.json().data, {
    base: 'NO-OVER',
    quote: 'USD',
  })
})

test('request overrides take precedence over adapter hardcoded ones', async (t) => {
  const response = await t.context.testAdapter.request({
    base: 'OVER1',
    quote: 'USD',
    overrides: {
      test_adapter: {
        OVER1: 'priority',
      },
    },
  })

  t.deepEqual(response.json().data, {
    base: 'priority',
    quote: 'USD',
  })
})

test('request overrides that resolve field to overridable symbol are not overriden from adapter overrides', async (t) => {
  const response = await t.context.testAdapter.request({
    base: 'OVER2',
    quote: 'USD',
    overrides: {
      test_adapter: {
        OVER2: 'OVER1',
      },
    },
  })

  t.deepEqual(response.json().data, {
    base: 'OVER1', // Want to check that it's not been overriden twice, which would be 'overriden_1'
    quote: 'USD',
  })
})

test('adapter overrides that resolve field to overridable symbol are not overriden from request overrides', async (t) => {
  const response = await t.context.testAdapter.request({
    base: 'OVER1',
    quote: 'USD',
    overrides: {
      test: {
        overriden_1: 'twice',
      },
    },
  })

  t.deepEqual(response.json().data, {
    base: 'overriden_1', // Want to check that it's not been overriden twice, which would be 'twice'
    quote: 'USD',
  })
})

test('adapter with overrideAdapterName uses overrideAdapterName', async (t) => {
  const response = await t.context.testAdapter.request({
    base: 'OVER2',
    quote: 'USD',
    adapterNameOverride: 'overridetest',
    overrides: {
      overridetest: {
        OVER2: 'valid',
      },
      test: {
        OVER2: 'invalid',
      },
    },
  })

  t.deepEqual(response.json().data, {
    base: 'valid',
    quote: 'USD',
  })
})

test('adapterNameOverride can use hyphen', async (t) => {
  const response = await t.context.testAdapter.request({
    base: 'OVER2',
    quote: 'USD',
    adapterNameOverride: 'override-test',
    overrides: {
      override_test: {
        OVER2: 'valid',
      },
      test: {
        OVER2: 'invalid',
      },
    },
  })

  t.deepEqual(response.json().data, {
    base: 'valid',
    quote: 'USD',
  })
})

test('adapter with overrideAdapterName uses original name if no override specified for overrideAdapterName', async (t) => {
  const response = await t.context.testAdapter.request({
    base: 'OVER2',
    quote: 'USD',
    adapterNameOverride: 'overridetest',
    overrides: {
      test_adapter: {
        OVER2: 'overridden',
      },
    },
  })

  t.deepEqual(response.json().data, {
    base: 'overridden',
    quote: 'USD',
  })
})

test('adapter name in overrides can have hyphen', async (t) => {
  const response = await t.context.testAdapter.request({
    base: 'OVER2',
    quote: 'USD',
    overrides: {
      'test-adapter': {
        OVER2: 'qweqwe',
      },
    },
  })

  t.deepEqual(response.json().data, {
    base: 'qweqwe',
    quote: 'USD',
  })
})
