import untypedTest, { TestFn } from 'ava'
import axios from 'axios'
import { AddressInfo } from 'net'
import { expose } from '../../src'
import { Adapter, AdapterEndpoint, EndpointGenerics } from '../../src/adapter'
import { Cache } from '../../src/cache'
import { BaseSettings } from '../../src/config'
import { AdapterRequest, AdapterResponse } from '../../src/util'
import { InputValidator } from '../../src/validation/input-validator'
import { NopTransport, NopTransportTypes } from '../util'

const test = untypedTest as TestFn<{
  serverAddress: string
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
        initialize: async (dependencies, config) => {
          return
        },
        transport: new (class extends NopTransport {
          override async foregroundExecute(req: AdapterRequest<NopTransportTypes['Request']>) {
            return {
              data: null,
              statusCode: 200,
              result: req.requestContext.cacheKey as unknown as null,
              timestamps: {
                providerDataRequested: 0,
                providerDataReceived: 0,
                providerIndicatedTime: undefined,
              },
            }
          }
        })(),
        validator: new InputValidator({}),
      },
      {
        name: 'test-custom-cache-key',
        inputParameters: {},
        initialize: async (dependencies, config) => {
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
  const api = await expose(adapter)
  if (!api) {
    throw 'Server did not start'
  }
  t.context.serverAddress = `http://localhost:${(api.server.address() as AddressInfo).port}`
})

test.serial('no parameters returns default cache key', async (t) => {
  const response = await axios.post(`${t.context.serverAddress}`, {})
  t.is(response.data.result, BaseSettings.DEFAULT_CACHE_KEY.default)
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
  const response = await axios.post(`${t.context.serverAddress}`, {
    data: {
      base: 'eth',
      factor: 123,
      proper: true,
      details: {
        asd: 'qwe',
        zxc: 432,
      },
      nullable: null,
    },
  })
  t.is(response.data.result, 'test-|base:eth|factor:123|proper:true|details:')
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
  const response = await axios.post(`${t.context.serverAddress}`, {
    data: {
      base: Array(100)
        .fill(null)
        .map((s, i) => `----------${i}`)
        .join('|'),
    },
  })
  t.is(response.data.result.length, 150 + 1 + 4) // Max common key + separator + endpoint name
})

test.serial('custom cache key', async (t) => {
  const response = await axios.post(`${t.context.serverAddress}`, {
    endpoint: 'test-custom-cache-key',
  })
  t.is(response.data.result, 'test:custom_cache_key')
})
