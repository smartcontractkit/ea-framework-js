import untypedTest, { TestFn } from 'ava'
import { Adapter, AdapterEndpoint, EndpointGenerics } from '../../src/adapter'
import { Cache, calculateCacheKey } from '../../src/cache'
import { BaseSettingsDefinition, AdapterConfig, BaseAdapterSettings } from '../../src/config'
import { AdapterRequest, AdapterResponse } from '../../src/util'
import { InputValidator } from '../../src/validation/input-validator'
import { NopTransport, NopTransportTypes, TestAdapter } from '../util'

const test = untypedTest as TestFn<{
  testAdapter: TestAdapter
  cache: Cache
  adapterEndpoint: AdapterEndpoint<EndpointGenerics>
}>

test.beforeEach(async (t) => {
  const config = new AdapterConfig(
    {},
    {
      envDefaultOverrides: {
        MAX_COMMON_KEY_SIZE: 150,
      },
    },
  )
  const adapter = new Adapter({
    name: 'TEST',
    defaultEndpoint: 'test',
    config,
    endpoints: [
      new AdapterEndpoint({
        name: 'test',
        inputParameters: {},
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
      }),
      new AdapterEndpoint({
        name: 'test-custom-cache-key',
        inputParameters: {},
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
      }),
      new AdapterEndpoint({
        name: 'test-custom-cache-key-long',
        inputParameters: {},
        cacheKeyGenerator: (_) => {
          return  `test:custom_cache_key_long_${'a'.repeat(200)}`
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
      }),
    ],
  })

  t.context.adapterEndpoint = adapter.endpoints[0]
  t.context.testAdapter = await TestAdapter.start(adapter, t.context)
})

test.serial('no parameters returns default cache key', async (t) => {
  const response = await t.context.testAdapter.request({})
  t.is(
    response.json().result,
    `TEST-test-default_single_transport-${BaseSettingsDefinition.DEFAULT_CACHE_KEY.default}`,
  )
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
    'TEST-test-default_single_transport-{"base":"eth","factor":123,"proper":true,"details":{"asd":"qwe","zxc":432}}',
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
  t.is(response.json().result.length, 4 + 1 + 4 + 1 + 24 + 1 + 28) // Adapter Name + separator + Endpoint Name + separator + Transport Name + Hash
})

test.serial('custom cache key', async (t) => {
  const response = await t.context.testAdapter.request({
    endpoint: 'test-custom-cache-key',
  })
  t.is(response.json().result, 'test:custom_cache_key')
})

test.serial('custom cache key is truncated if over max size', async (t) => {
  const response = await t.context.testAdapter.request({
    endpoint: 'test-custom-cache-key-long',
  })
  t.is(response.json().result, `test:custom_cache_key_long_${'a'.repeat(123)}`)
})

test.serial('throws error when cache data is not object', async (t) => {
  try {
    calculateCacheKey({
      transportName: 'test',
      data: 'test',
      inputParameters: { base: { type: 'string', required: true } },
      adapterName: 'test',
      endpointName: 'test',
      adapterSettings: {} as BaseAdapterSettings
    })
    t.fail()
  } catch (e: unknown) {
    t.pass()
  }
})