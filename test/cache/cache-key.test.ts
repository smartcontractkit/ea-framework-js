import untypedTest, { TestFn } from 'ava'
import { Adapter, AdapterEndpoint, EndpointGenerics } from '../../src/adapter'
import { Cache, calculateCacheKey } from '../../src/cache'
import { AdapterConfig, BaseAdapterSettings, BaseSettingsDefinition } from '../../src/config'
import { AdapterRequest, AdapterResponse } from '../../src/util'
import { NopTransport, NopTransportTypes, TestAdapter } from '../../src/util/testing-utils'
import { InputParameters } from '../../src/validation'
import { InputParametersDefinition } from '../../src/validation/input-params'

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
        transport: new (class extends NopTransport {
          override async foregroundExecute(req: AdapterRequest<NopTransportTypes['Parameters']>) {
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
        cacheKeyGenerator: (_) => {
          return `test:custom_cache_key`
        },
        transport: new (class extends NopTransport {
          override async foregroundExecute(req: AdapterRequest<NopTransportTypes['Parameters']>) {
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
        cacheKeyGenerator: (_) => {
          return `test:custom_cache_key_long_${'a'.repeat(200)}`
        },
        transport: new (class extends NopTransport {
          override async foregroundExecute(req: AdapterRequest<NopTransportTypes['Parameters']>) {
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
  const nestedParams = {
    asd: {
      type: 'string',
      description: 'asd',
    },
    zxc: {
      type: 'number',
      description: 'zxc',
    },
  } as const

  t.context.adapterEndpoint.inputParameters = new InputParameters({
    base: {
      type: 'string',
      description: 'base',
      required: true,
    },
    quote: {
      type: 'string',
      description: 'quote',
    },
    factor: {
      type: 'number',
      description: 'factor',
      required: true,
    },
    proper: {
      type: 'boolean',
      description: 'proper',
    },
    details: {
      type: nestedParams,
      description: 'details',
      required: true,
    },
    nullable: {
      type: nestedParams,
      description: 'nullable',
    },
  }) as InputParameters<InputParametersDefinition>

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
  t.context.adapterEndpoint.inputParameters = new InputParameters({
    base: {
      type: 'string',
      description: 'base',
      required: true,
    },
  })

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
  // Long (over max size) custom cache keys are hashed
  t.is(response.json().result, `246jgkr8izMcjuWe+ziM65i7LWc=`)
})

test.serial('throws error when cache data is not object', async (t) => {
  try {
    calculateCacheKey({
      transportName: 'test',
      // @ts-expect-error we want to test the runtime error
      data: 'test',
      inputParameters: new InputParameters({
        base: { type: 'string', description: 'base', required: true },
      }),
      adapterName: 'test',
      endpointName: 'test',
      adapterSettings: {} as BaseAdapterSettings,
    })
    t.fail()
  } catch (e: unknown) {
    t.pass()
  }
})

test.serial('adds cache prefix to cache keys', async (t) => {
  process.env['CACHE_PREFIX'] = 'prefix'
  const config = new AdapterConfig({})
  const adapter = new Adapter({
    name: 'TEST',
    defaultEndpoint: 'test',
    config,
    endpoints: [
      new AdapterEndpoint({
        name: 'test',
        transport: new (class extends NopTransport {
          override async foregroundExecute(req: AdapterRequest<NopTransportTypes['Parameters']>) {
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
        cacheKeyGenerator: (_) => {
          return `test:custom_cache_key`
        },
        transport: new (class extends NopTransport {
          override async foregroundExecute(req: AdapterRequest<NopTransportTypes['Parameters']>) {
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
        cacheKeyGenerator: (_) => {
          return `test:custom_cache_key_long_${'a'.repeat(200)}`
        },
        transport: new (class extends NopTransport {
          override async foregroundExecute(req: AdapterRequest<NopTransportTypes['Parameters']>) {
            return {
              data: null,
              statusCode: 200,
              result: req.requestContext.cacheKey as unknown,
            } as AdapterResponse<NopTransportTypes['Response']>
          }
        })(),
      }),
      new AdapterEndpoint({
        name: 'no-generator-cache-key',
        transport: new (class extends NopTransport {
          override async foregroundExecute(req: AdapterRequest<NopTransportTypes['Parameters']>) {
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

  const response = await t.context.testAdapter.request({
    endpoint: 'test-custom-cache-key',
  })

  t.is(response.json().result, 'prefix-test:custom_cache_key')

  const response2 = await t.context.testAdapter.request({
    endpoint: 'test-custom-cache-key-long',
  })

  t.is(response2.json().result, `prefix-test:custom_cache_key_long_${'a'.repeat(200)}`)

  const response3 = await t.context.testAdapter.request({
    endpoint: 'no-generator-cache-key',
  })

  t.is(
    response3.json().result,
    'prefix-TEST-no-generator-cache-key-default_single_transport-DEFAULT_CACHE_KEY',
  )
})
