import { InstalledClock } from '@sinonjs/fake-timers'
import { installTimers } from '../helper'
import untypedTest, { TestFn } from 'ava'
import { FastifyInstance } from 'fastify'
import { Adapter, AdapterEndpoint } from '../../src/adapter'
import { AdapterConfig, SettingsDefinitionFromConfig } from '../../src/config'
import { AdapterRequest } from '../../src/util'
import { TypeFromDefinition } from '../../src/validation/input-params'
import {
  NopTransport,
  TestAdapter,
  assertEqualResponses,
  runAllUntilTime,
} from '../../src/util/testing-utils'
import { cacheTestInputParameters, CacheTestTransportTypes } from './helper'

const test = untypedTest as TestFn<{
  clock: InstalledClock
  testAdapter: TestAdapter<SettingsDefinitionFromConfig<typeof config>>
  api: FastifyInstance | undefined
}>

test.before((t) => {
  t.context.clock = installTimers()
})

test.afterEach(async (t) => {
  t.context.clock.reset()
  await t.context.testAdapter?.api.close()
})

const price = 1234
const apiKey = 'mock-api-key'

process.env['CACHE_POLLING_MAX_RETRIES'] = '0'
process.env['RETRY'] = '0'
process.env['API_TIMEOUT'] = '0'

export const config = new AdapterConfig({
  API_KEY: {
    description: 'API key',
    type: 'string',
    required: true,
    sensitive: true,
  },
})

test.serial('sensitive settings are censored in the response cache', async (t) => {
  process.env['API_KEY'] = apiKey
  const adapter = new Adapter({
    name: 'TEST',
    defaultEndpoint: 'test',
    config,
    endpoints: [
      new AdapterEndpoint({
        name: 'test',
        transport: new (class extends NopTransport<CacheTestTransportTypes> {
          override async foregroundExecute(
            req: AdapterRequest<TypeFromDefinition<CacheTestTransportTypes['Parameters']>>,
          ): Promise<void> {
            await this.responseCache.write(this.name, [
              {
                params: req.requestContext.data,
                response: {
                  data: {
                    result: price,
                    api_key: `API KEY for request ${apiKey}`,
                  } as unknown as null,
                  result: price,
                  timestamps: {
                    providerDataRequestedUnixMs: 0,
                    providerDataReceivedUnixMs: 0,
                    providerIndicatedTimeUnixMs: undefined,
                  },
                },
              },
            ])
          }
        })(),
      }),
    ],
  })

  const testAdapter = await TestAdapter.startWithMockedCache(adapter, t.context)
  const response = await testAdapter.request({})
  assertEqualResponses(t, response.json(), {
    data: {
      result: price,
      api_key: 'API KEY for request [API_KEY REDACTED]',
    },
    result: price,
    statusCode: 200,
  })
})

test.serial('writes error response when censoring fails', async (t) => {
  process.env['API_KEY'] = apiKey
  const adapter = new Adapter({
    name: 'TEST',
    defaultEndpoint: 'test',
    config,
    endpoints: [
      new AdapterEndpoint({
        name: 'test',
        transport: new (class extends NopTransport<CacheTestTransportTypes> {
          override async foregroundExecute(
            req: AdapterRequest<TypeFromDefinition<CacheTestTransportTypes['Parameters']>>,
          ): Promise<void> {
            const circular: { circular?: unknown } = {}
            circular.circular = circular
            await this.responseCache.write(this.name, [
              {
                params: req.requestContext.data,
                response: {
                  data: circular as unknown as null,
                  result: price,
                  timestamps: {
                    providerDataRequestedUnixMs: 0,
                    providerDataReceivedUnixMs: 0,
                    providerIndicatedTimeUnixMs: undefined,
                  },
                },
              },
            ])
          }
        })(),
      }),
    ],
  })

  const testAdapter = await TestAdapter.startWithMockedCache(adapter, t.context)
  const response = await testAdapter.request({})
  assertEqualResponses(t, response.json(), {
    errorMessage: 'Response could not be censored due to an error',
    statusCode: 502,
  })
})

test.serial('updates the response cache ttl', async (t) => {
  process.env['API_KEY'] = apiKey
  let requestCount = 0
  const adapter = new Adapter({
    name: 'TEST',
    defaultEndpoint: 'test',
    config,
    endpoints: [
      new AdapterEndpoint({
        name: 'test',
        inputParameters: cacheTestInputParameters,
        transport: new (class extends NopTransport<CacheTestTransportTypes> {
          override async foregroundExecute(
            req: AdapterRequest<TypeFromDefinition<CacheTestTransportTypes['Parameters']>>,
          ): Promise<void> {
            // Simulating a signal that should update already cached entries
            if (requestCount === 1) {
              const entries = [{ base: 'BTC', factor: 10 }]
              await this.responseCache.writeTTL(this.name, entries, 120_000)
            }

            if (requestCount === 0) {
              await this.responseCache.write(this.name, [
                {
                  params: req.requestContext.data,
                  response: {
                    data: null,
                    result: price,
                    timestamps: {
                      providerDataRequestedUnixMs: 0,
                      providerDataReceivedUnixMs: 0,
                      providerIndicatedTimeUnixMs: undefined,
                    },
                  },
                },
              ])
            }
            requestCount++
          }
        })(),
      }),
    ],
  })

  const testAdapter = await TestAdapter.startWithMockedCache(adapter, t.context)
  // First request sets the response in the cache
  await testAdapter.request({ base: 'BTC', factor: 10 })
  // On second request we refresh the cache TTL of a response with factor:10, and set it to 120_000
  await testAdapter.request({ base: 'BTC', factor: 11 })
  // Advancing the clock to make sure that the TTL was updated and we get the response
  await runAllUntilTime(t.context.clock, 110000)
  const response = await testAdapter.request({ base: 'BTC', factor: 10 })

  t.is(response.json().statusCode, 200)
  t.is(response.json().result, 1234)
})
