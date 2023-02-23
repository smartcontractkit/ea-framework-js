import untypedTest, { TestFn } from 'ava'
import nock from 'nock'
import { Adapter, AdapterEndpoint } from '../../src/adapter'
import { SettingsMap } from '../../src/config'
import { retrieveCost } from '../../src/metrics'
import { HttpTransport } from '../../src/transports'
import { TestAdapter } from '../util'

const test = untypedTest as TestFn<{
  testAdapter: TestAdapter
}>

const URL = 'http://test-url.com'

interface AdapterRequestParams {
  from: string
  to: string
}

interface ProviderRequestBody {
  base: string
  quote: string
}

interface ProviderResponseBody {
  price: number
}

type RestEndpointTypes = {
  Request: {
    Params: AdapterRequestParams
  }
  Response: {
    Data: {
      price: number
    }
    Result: number
  }
  CustomSettings: SettingsMap
  Provider: {
    RequestBody: ProviderRequestBody
    ResponseBody: ProviderResponseBody
  }
}

const endpoint = '/price'

const createAdapterEndpoint = (): AdapterEndpoint<RestEndpointTypes> => {
  const restEndpointTransport = new HttpTransport<RestEndpointTypes>({
    prepareRequests: (params) => {
      return params.map((req) => ({
        params: [req],
        request: {
          baseURL: URL,
          url: endpoint,
          method: 'GET',
          params: {
            base: req.from,
            quote: req.to,
          },
        },
      }))
    },
    parseResponse: (params, res) => {
      return [
        {
          params: params[0],
          response: {
            data: res.data,
            statusCode: 200,
            result: res.data.price,
            timestamps: {
              providerIndicatedTimeUnixMs: Date.now() - 100,
            },
          },
        },
      ]
    },
  })

  return new AdapterEndpoint({
    name: 'TEST',
    inputParameters: {
      from: {
        type: 'string',
        required: true,
      },
      to: {
        type: 'string',
        required: true,
      },
    },
    transport: restEndpointTransport,
  })
}

const from = 'ETH'
const to = 'USD'
const price = 1234
const version = process.env['npm_package_version']

test.before(async (t) => {
  process.env['METRICS_ENABLED'] = 'true'
  const adapter = new Adapter({
    name: 'TEST',
    defaultEndpoint: 'test',
    endpoints: [createAdapterEndpoint()],
    envDefaultOverrides: {
      RATE_LIMIT_CAPACITY_SECOND: 10,
    },
  })

  t.context.testAdapter = await TestAdapter.start(adapter, t.context)
})

test.serial('Test http requests total metrics (data provider hit)', async (t) => {
  nock(URL)
    .get(endpoint)
    .query({
      base: from,
      quote: to,
    })
    .reply(200, {
      price,
    })

  await t.context.testAdapter.request({ from, to })

  const metricsMap = await t.context.testAdapter.getMetrics()
  const expectedLabel = `{method="POST",feed_id="{\\"from\\":\\"eth\\",\\"to\\":\\"usd\\"}",status_code="200",type="dataProviderHit",provider_status_code="200",app_name="TEST",app_version="${version}"}`
  t.is(metricsMap.get(`http_requests_total${expectedLabel}`), 1)
})

test.serial('Test http request duration metrics', async (t) => {
  const metricsMap = await t.context.testAdapter.getMetrics()
  const expectedLabel = `{app_name="TEST",app_version="${version}"}`
  const responseTime = metricsMap.get(`http_request_duration_seconds_sum${expectedLabel}`)
  if (responseTime !== undefined) {
    t.is(typeof responseTime === 'number', true)
    t.is(responseTime > 0, true)
  } else {
    t.fail('Response time did not record')
  }
})

test.serial('Test data provider requests metrics', async (t) => {
  const metricsMap = await t.context.testAdapter.getMetrics()
  const expectedLabel = `{provider_status_code="200",method="GET",app_name="TEST",app_version="${version}"}`
  t.is(metricsMap.get(`data_provider_requests${expectedLabel}`), 1)
})

test.serial('Test data provider request duration metrics', async (t) => {
  const metricsMap = await t.context.testAdapter.getMetrics()
  const expectedLabel = `{app_name="TEST",app_version="${version}"}`
  const responseTime = metricsMap.get(`data_provider_request_duration_seconds_sum${expectedLabel}`)
  if (responseTime !== undefined) {
    t.is(typeof responseTime === 'number', true)
    t.is(responseTime > 0, true)
  } else {
    t.fail('Response time did not record')
  }
})

test.serial('Test cache set count metrics', async (t) => {
  const metricsMap = await t.context.testAdapter.getMetrics()
  const expectedLabel = `{participant_id="TEST-test-{\\"from\\":\\"eth\\",\\"to\\":\\"usd\\"}",feed_id="{\\"from\\":\\"eth\\",\\"to\\":\\"usd\\"}",cache_type="local",app_name="TEST",app_version="${version}"}`
  t.is(metricsMap.get(`cache_data_set_count${expectedLabel}`), 1)
})

test.serial('Test cache max age metrics', async (t) => {
  const metricsMap = await t.context.testAdapter.getMetrics()
  const expectedLabel = `{participant_id="TEST-test-{\\"from\\":\\"eth\\",\\"to\\":\\"usd\\"}",feed_id="{\\"from\\":\\"eth\\",\\"to\\":\\"usd\\"}",cache_type="local",app_name="TEST",app_version="${version}"}`
  t.is(metricsMap.get(`cache_data_max_age${expectedLabel}`), 90000)
})

test.serial('Test cache set staleness metrics', async (t) => {
  const metricsMap = await t.context.testAdapter.getMetrics()
  const expectedLabel = `{participant_id="TEST-test-{\\"from\\":\\"eth\\",\\"to\\":\\"usd\\"}",feed_id="{\\"from\\":\\"eth\\",\\"to\\":\\"usd\\"}",cache_type="local",app_name="TEST",app_version="${version}"}`
  const staleness = metricsMap.get(`cache_data_staleness_seconds${expectedLabel}`)
  if (staleness !== undefined) {
    t.is(typeof staleness === 'number', true)
    t.is(staleness === 0, true)
  } else {
    t.fail('Staleness was not retrieved')
  }
})

test.serial('Test provider time delta metric', async (t) => {
  const metricsMap = await t.context.testAdapter.getMetrics()
  const expectedLabel = `{participant_id="TEST-test-{\\"from\\":\\"eth\\",\\"to\\":\\"usd\\"}",feed_id="{\\"from\\":\\"eth\\",\\"to\\":\\"usd\\"}",cache_type="local",app_name="TEST",app_version="${version}"}`
  t.is(metricsMap.get(`cache_data_max_age${expectedLabel}`), 90000)
})

test.serial('Test credit spent metrics', async (t) => {
  const metricsMap = await t.context.testAdapter.getMetrics()
  const expectedLabel = `{feed_id="N/A",participant_id="9002",app_name="TEST",app_version="${version}"}`
  t.is(metricsMap.get(`rate_limit_credits_spent_total${expectedLabel}`), 1)
})

test.serial('Test http requests total metrics (cache hit)', async (t) => {
  nock(URL)
    .get(endpoint)
    .query({
      base: from,
      quote: to,
    })
    .reply(200, {
      price,
    })

  await t.context.testAdapter.request({ from, to })

  const metricsMap = await t.context.testAdapter.getMetrics()
  const expectedLabel = `{method="POST",feed_id="{\\"from\\":\\"eth\\",\\"to\\":\\"usd\\"}",status_code="200",type="cacheHit",app_name="TEST",app_version="${version}"}`
  t.is(metricsMap.get(`http_requests_total${expectedLabel}`), 1)
})

test.serial('Test cache get count metrics', async (t) => {
  const metricsMap = await t.context.testAdapter.getMetrics()
  const expectedLabel = `{participant_id="TEST-test-{\\"from\\":\\"eth\\",\\"to\\":\\"usd\\"}",feed_id="{\\"from\\":\\"eth\\",\\"to\\":\\"usd\\"}",cache_type="local",app_name="TEST",app_version="${version}"}`
  t.is(metricsMap.get(`cache_data_get_count${expectedLabel}`), 1)
})

test.serial('Test cache get value metrics', async (t) => {
  const metricsMap = await t.context.testAdapter.getMetrics()
  const expectedLabel = `{participant_id="TEST-test-{\\"from\\":\\"eth\\",\\"to\\":\\"usd\\"}",feed_id="{\\"from\\":\\"eth\\",\\"to\\":\\"usd\\"}",cache_type="local",app_name="TEST",app_version="${version}"}`
  t.is(metricsMap.get(`cache_data_get_values${expectedLabel}`), 1234)
})

test.serial('Test cache get staleness metrics', async (t) => {
  const metricsMap = await t.context.testAdapter.getMetrics()
  const expectedLabel = `{participant_id="TEST-test-{\\"from\\":\\"eth\\",\\"to\\":\\"usd\\"}",feed_id="{\\"from\\":\\"eth\\",\\"to\\":\\"usd\\"}",cache_type="local",app_name="TEST",app_version="${version}"}`
  const staleness = metricsMap.get(`cache_data_staleness_seconds${expectedLabel}`)
  if (staleness !== undefined) {
    t.is(typeof staleness === 'number', true)
    t.is(staleness > 0, true)
  } else {
    t.fail('Staleness was not retrieved')
  }
})

test('Rate limit metrics retrieve cost (default)', async (t) => {
  const cost = retrieveCost({ data: {}, statusCode: 200 })
  t.is(cost, 1)
})

test('Rate limit metrics retrieve cost (number)', async (t) => {
  const cost = retrieveCost({ data: {}, statusCode: 200, cost: 3 })
  t.is(cost, 3)
})

test('Rate limit metrics retrieve cost (string)', async (t) => {
  const cost = retrieveCost({ data: {}, statusCode: 200, cost: '3' })
  t.is(cost, 3)
})
