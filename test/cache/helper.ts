import untypedTest, { TestFn } from 'ava'
import axios, { AxiosError } from 'axios'
import { Adapter, AdapterEndpoint } from '../../src/adapter'
import { Cache } from '../../src/cache'
import { AdapterRequest } from '../../src/util'
import { NopTransport, NopTransportTypes } from '../util'

export const test = untypedTest as TestFn<{
  serverAddress: string
  cache: Cache
  adapterEndpoint: AdapterEndpoint<NopTransportTypes>
}>

export class BasicCacheSetterTransport extends NopTransport {
  override async foregroundExecute(req: AdapterRequest): Promise<void> {
    await this.responseCache.write([
      {
        params: req.requestContext.data,
        response: {
          data: null,
          result: req.requestContext.data['factor'] as null,
          timestamps: {
            providerDataRequestedUnixMs: 0,
            providerDataReceivedUnixMs: 0,
            providerIndicatedTimeUnixMs: undefined,
          },
        },
      },
    ])
  }
}

export class DifferentResultTransport extends NopTransport {
  override async foregroundExecute(req: AdapterRequest): Promise<void> {
    await this.responseCache.write([
      {
        params: req.requestContext.data,
        response: {
          data: null,
          result: Date.now() as unknown as null,
          timestamps: {
            providerDataRequestedUnixMs: 0,
            providerDataReceivedUnixMs: 0,
            providerIndicatedTimeUnixMs: undefined,
          },
        },
      },
    ])
  }
}

export function buildDiffResultAdapter(name: Uppercase<string>) {
  return new Adapter({
    name,
    defaultEndpoint: 'test',
    endpoints: [
      new AdapterEndpoint({
        name: 'test',
        inputParameters: {
          base: {
            type: 'string',
            required: true,
          },
        },
        transport: new DifferentResultTransport(),
      }),
    ],
  })
}

export const cacheTests = () => {
  test('returns value set in cache from setup', async (t) => {
    const data = {
      base: 'eth',
      factor: 123,
    }

    const response = await axios.post(`${t.context.serverAddress}`, { data })
    t.is(response.data.result, 123)
  })

  test('returns value already found in cache', async (t) => {
    const data = {
      base: 'qweqwe',
      factor: 111,
    }

    const cacheKey = 'TEST-test-{"base":"qweqwe","factor":111}'

    // Inject values directly into the cache
    const injectedEntry = {
      data: null,
      statusCode: 200,
      result: 'injected',
    }

    t.context.cache.set(cacheKey, injectedEntry, 10000)

    const response = await axios.post(`${t.context.serverAddress}`, { data })
    t.is(response.data.result, 'injected')
  })

  test('skips expired cache entry and returns set up value', async (t) => {
    const data = {
      base: 'sdfghj',
      factor: 24637,
    }

    const cacheKey = 'TEST-test-{"base":"sdfghj","factor":24637}'

    // Inject values directly into the cache
    const injectedEntry = {
      data: null,
      statusCode: 200,
      result: 'injected',
    }

    t.context.cache.set(cacheKey, injectedEntry, -10)

    const response = await axios.post(`${t.context.serverAddress}`, { data })
    t.is(response.data.result, 24637)
  })

  test('polls forever and returns timeout', async (t) => {
    const makeRequest = () =>
      axios.post(`${t.context.serverAddress}`, {
        endpoint: 'nowork',
      })
    const error: AxiosError | undefined = await t.throwsAsync(makeRequest)
    t.is(error?.response?.status, 504)
  })
}
