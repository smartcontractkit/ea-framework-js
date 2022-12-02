import test from 'ava'
import nock from 'nock'
import { Adapter } from '../../src/adapter'
import { axiosRequest } from '../../src/transports/util'
import { AdapterError } from '../../src/validation/error'
import { createAdapterEndpoint } from './helper'

const URL = 'http://test-url.com'
const endpoint = '/price'

const from = 'ETH'
const to = 'USD'

test.before(() => {
  nock.disableNetConnect()
  nock.enableNetConnect('localhost')
})

test.after(() => {
  nock.restore()
})

const request = {
  baseURL: URL,
  url: endpoint,
  method: 'GET',
  params: {
    base: from,
    quote: to,
  },
}

test.serial('Test axios request util (500)', async (t) => {
  nock(URL)
    .get(endpoint)
    .query({
      base: from,
      quote: to,
    })
    .reply(500)

  const adapter = new Adapter({
    name: 'TEST',
    defaultEndpoint: 'test',
    endpoints: [createAdapterEndpoint()],
  })

  const error: AdapterError | undefined = await t.throwsAsync(axiosRequest(request, adapter.config))
  t.is(error?.statusCode, 200)
  t.is(error?.providerStatusCode, 500)
})

test.serial('Test axios request util (no response)', async (t) => {
  nock(URL)
    .get(endpoint)
    .query({
      base: from,
      quote: to,
    })
    .replyWithError('Error')

  const adapter = new Adapter({
    name: 'TEST',
    defaultEndpoint: 'test',
    endpoints: [createAdapterEndpoint()],
  })

  const error: AdapterError | undefined = await t.throwsAsync(axiosRequest(request, adapter.config))
  t.is(error?.statusCode, 200)
  t.is(error?.providerStatusCode, 0)
})

test.serial('Test retries', async (t) => {
  let errorCount = 0
  nock(URL)
    .get(endpoint)
    .query({
      base: from,
      quote: to,
    })
    .reply(() => {
      if (errorCount >= 2) {
        return [200, 'success']
      }
      errorCount += 1
      return [400, {}]
    })
    .persist()

  const adapter = new Adapter({
    name: 'TEST',
    envDefaultOverrides: { RETRY: 3 },
    defaultEndpoint: 'test',
    endpoints: [createAdapterEndpoint()],
  })

  const response = await axiosRequest(request, adapter.config)
  t.is(errorCount, 2)
  t.is(response.data, 'success')
})
