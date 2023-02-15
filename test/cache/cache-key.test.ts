import untypedTest, { TestFn } from 'ava'
import { Adapter, AdapterEndpoint, EndpointGenerics } from '../../src/adapter'
import { Cache } from '../../src/cache'
import { BaseSettings } from '../../src/config'
import { AdapterRequest, AdapterResponse } from '../../src/util'
import { InputValidator } from '../../src/validation/input-validator'
import { NopTransport, NopTransportTypes, TestAdapter } from '../util'

const test = untypedTest as TestFn<{
  testAdapter: TestAdapter
  cache: Cache
  adapterEndpoint: AdapterEndpoint<EndpointGenerics>
}>

test.beforeEach(async (t) => {
  const adapter = new Adapter({
    name: 'TEST',
    defaultEndpoint: 'test',
    endpoints: [
      {
        name: 'test',
        inputParameters: {},
        initialize: async () => {
          return
        },
        transport: new (class extends NopTransport {
          override async foregroundExecute(req: AdapterRequest<NopTransportTypes['Request']>) {
            return {
              data: null,
              statusCode: 200,
              result: req.requestContext.cacheKey as unknown as null,
              timestamps: {
                providerDataRequestedUnixMs: 0,
                providerDataReceivedUnixMs: 0,
                providerIndicatedTimeUnixMs: undefined,
              },
            }
          }
        })(),
        validator: new InputValidator({}),
      },
      {
        name: 'test-custom-cache-key',
        inputParameters: {},
        initialize: async () => {
          return
        },
        cacheKeyGenerator: (_) => {
          return `test:custom_cache_key`
        },
        transport: new (class extends NopTransport {
          override async foregroundExecute(req: AdapterRequest<NopTransportTypes['Request']>) {
            return {
              data: null,
              statusCode: 200,
              result: req.requestContext.cacheKey as unknown,
            } as AdapterResponse<NopTransportTypes['Response']>
          }
        })(),
        validator: new InputValidator({}),
      },
    ],
    envDefaultOverrides: {
      MAX_COMMON_KEY_SIZE: 150,
    },
  })

  t.context.adapterEndpoint = adapter.endpoints[0]
  t.context.testAdapter = await TestAdapter.start(adapter, t.context)
})

test.serial('no parameters returns default cache key', async (t) => {
  const response = await t.context.testAdapter.request({})
  t.is(response.json().result, BaseSettings.DEFAULT_CACHE_KEY.default)
})

test.serial('builds cache key correctly from input params', async (t) => {
  t.context.adapterEndpoint.inputParameters = {
    base: {
      type: 'string',
      required: true,
    },
    quote: {
      type: 'string',
      required: false,
    },
    factor: {
      type: 'number',
      required: true,
    },
    proper: {
      type: 'boolean',
      required: false,
    },
    details: {
      type: 'object',
      required: true,
    },
    nullable: {
      type: 'object',
      required: false,
    },
  }
  t.context.adapterEndpoint.validator = new InputValidator(
    t.context.adapterEndpoint.inputParameters,
  )
  const response = await t.context.testAdapter.request({
    base: 'eth',
    factor: 123,
    proper: true,
    details: {
      asd: 'qwe',
      zxc: 432,
    },
    nullable: null,
  })
  t.is(
    response.json().result,
    'TEST-test-{"base":"eth","factor":123,"proper":true,"details":{"asd":"qwe","zxc":432}}',
  )
})

test.serial('cache key is truncated if over max size', async (t) => {
  t.context.adapterEndpoint.inputParameters = {
    base: {
      type: 'string',
      required: true,
    },
  }
  t.context.adapterEndpoint.validator = new InputValidator(
    t.context.adapterEndpoint.inputParameters,
  )
  const response = await t.context.testAdapter.request({
    base: Array(100)
      .fill(null)
      .map((s, i) => `----------${i}`)
      .join('|'),
  })
  t.is(response.json().result.length, 4 + 1 + 4 + 1 + 150) // Adapter Name + separator + Endpoint Name + separator + Max common key
})

test.serial('custom cache key', async (t) => {
  const response = await t.context.testAdapter.request({
    endpoint: 'test-custom-cache-key',
  })
  t.is(response.json().result, 'test:custom_cache_key')
})
