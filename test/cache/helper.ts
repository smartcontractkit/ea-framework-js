import untypedTest, { TestFn } from 'ava'
import axios, { AxiosError } from 'axios'
import { AdapterEndpoint } from '../../src/adapter'
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
            providerDataRequested: 0,
            providerDataReceivedUnixMs: 0,
            providerIndicatedTimeUnixMs: undefined,
          },
        },
      },
    ])
  }
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

    const cacheKey = 'test-{"base":"qweqwe","factor":111}'

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

    const cacheKey = 'test-{"base":"sdfghj","factor":24637}'

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
