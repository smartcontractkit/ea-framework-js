import FakeTimers, { InstalledClock } from '@sinonjs/fake-timers'
import untypedTest, { TestFn } from 'ava'
import { FastifyInstance } from 'fastify'
import { Adapter, AdapterEndpoint } from '../../src/adapter'
import { AdapterConfig, SettingsDefinitionFromConfig } from '../../src/config'
import { AdapterRequest } from '../../src/util'
import { assertEqualResponses, NopTransport, TestAdapter } from '../util'

const test = untypedTest as TestFn<{
  clock: InstalledClock
  testAdapter: TestAdapter<SettingsDefinitionFromConfig<typeof config>>
  api: FastifyInstance | undefined
}>

test.beforeEach((t) => {
  t.context.clock = FakeTimers.install()
})

test.afterEach(async (t) => {
  t.context.clock.uninstall()
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
        inputParameters: {},
        transport: new (class extends NopTransport {
          override async foregroundExecute(req: AdapterRequest): Promise<void> {
            await this.responseCache.write(this.name, [
              {
                params: req.requestContext.data,
                response: {
                  data: {
                    result: price,
                    api_key: `API KEY for request ${apiKey}`,
                  } as unknown as null,
                  result: price as unknown as null,
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
        inputParameters: {},
        transport: new (class extends NopTransport {
          override async foregroundExecute(req: AdapterRequest): Promise<void> {
            const circular: { circular?: unknown } = {}
            circular.circular = circular
            await this.responseCache.write(this.name, [
              {
                params: req.requestContext.data,
                response: {
                  data: circular as unknown as null,
                  result: price as unknown as null,
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
