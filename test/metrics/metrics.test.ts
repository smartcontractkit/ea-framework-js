import untypedTest, { TestFn } from 'ava'
import axios, { AxiosRequestConfig } from 'axios'
import { AddressInfo } from 'net'
import nock from 'nock'
import { expose } from '../../src'
import { Adapter, AdapterEndpoint } from '../../src/adapter'
import { SettingsMap } from '../../src/config'
import { retrieveCost } from '../../src/rate-limiting/metrics'
import { RestTransport } from '../../src/transports'
import { parsePromMetrics } from './helper'

const test = untypedTest as TestFn<{
  serverAddress: string
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
  const restEndpointTransport = new RestTransport<RestEndpointTypes>({
    prepareRequest: (req): AxiosRequestConfig<ProviderRequestBody> => {
      return {
        baseURL: URL,
        url: endpoint,
        method: 'GET',
        params: {
          base: req.requestContext.data.from,
          quote: req.requestContext.data.to,
        },
      }
    },
    parseResponse: (req, res) => {
      return {
        data: res.data,
        statusCode: 200,
        result: res.data.price,
        timestamps: {
          providerIndicatedTime: Date.now() - 100,
        },
      }
    },
    options: {
      requestCoalescing: {
        enabled: true,
        entropyMax: 0,
      },
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
  // Set unique port between metrics tests to avoid conflicts in metrics servers
  process.env['METRICS_PORT'] = '9090'
  const adapter = new Adapter({
    name: 'TEST',
    defaultEndpoint: 'test',
    endpoints: [createAdapterEndpoint()],
  })

  const api = await expose(adapter)
  if (!api) {
    throw 'Server did not start'
  }
  t.context.serverAddress = `http://localhost:${(api.server.address() as AddressInfo).port}`
})

test.serial('Test http requests total metrics (data provider hit)', async (t) => {
  const metricsAddress = `http://localhost:${process.env['METRICS_PORT']}/metrics`
  nock(URL)
    .get(endpoint)
    .query({
      base: from,
      quote: to,
    })
    .reply(200, {
      price,
    })

  await axios.post(t.context.serverAddress, {
    data: {
      from,
      to,
    },
  })

  const response = await axios.get(metricsAddress)
  const metricsMap = parsePromMetrics(response.data)
  const expectedLabel = `{method="POST",feed_id="|from:eth|to:usd",status_code="200",type="dataProviderHit",provider_status_code="200",app_name="TEST",app_version="${version}"}`
  t.is(metricsMap.get(`http_requests_total${expectedLabel}`), 1)
})

test.serial('Test http request duration metrics', async (t) => {
  const metricsAddress = `http://localhost:${process.env['METRICS_PORT']}/metrics`
  const response = await axios.get(metricsAddress)
  const metricsMap = parsePromMetrics(response.data)
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
  const metricsAddress = `http://localhost:${process.env['METRICS_PORT']}/metrics`
  const response = await axios.get(metricsAddress)
  const metricsMap = parsePromMetrics(response.data)
  const expectedLabel = `{provider_status_code="200",method="GET",app_name="TEST",app_version="${version}"}`
  t.is(metricsMap.get(`data_provider_requests${expectedLabel}`), 1)
})

test.serial('Test data provider request duration metrics', async (t) => {
  const metricsAddress = `http://localhost:${process.env['METRICS_PORT']}/metrics`
  const response = await axios.get(metricsAddress)
  const metricsMap = parsePromMetrics(response.data)
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
  const metricsAddress = `http://localhost:${process.env['METRICS_PORT']}/metrics`
  const response = await axios.get(metricsAddress)
  const metricsMap = parsePromMetrics(response.data)
  const expectedLabel = `{participant_id="test-|from:eth|to:usd",feed_id="|from:eth|to:usd",cache_type="local",app_name="TEST",app_version="${version}"}`
  t.is(metricsMap.get(`cache_data_set_count${expectedLabel}`), 1)
})

test.serial('Test cache max age metrics', async (t) => {
  const metricsAddress = `http://localhost:${process.env['METRICS_PORT']}/metrics`
  const response = await axios.get(metricsAddress)
  const metricsMap = parsePromMetrics(response.data)
  const expectedLabel = `{participant_id="test-|from:eth|to:usd",feed_id="|from:eth|to:usd",cache_type="local",app_name="TEST",app_version="${version}"}`
  t.is(metricsMap.get(`cache_data_max_age${expectedLabel}`), 90000)
})

test.serial('Test cache set staleness metrics', async (t) => {
  const metricsAddress = `http://localhost:${process.env['METRICS_PORT']}/metrics`
  const response = await axios.get(metricsAddress)
  const metricsMap = parsePromMetrics(response.data)
  const expectedLabel = `{participant_id="test-|from:eth|to:usd",feed_id="|from:eth|to:usd",cache_type="local",app_name="TEST",app_version="${version}"}`
  const staleness = metricsMap.get(`cache_data_staleness_seconds${expectedLabel}`)
  if (staleness !== undefined) {
    t.is(typeof staleness === 'number', true)
    t.is(staleness === 0, true)
  } else {
    t.fail('Staleness was not retrieved')
  }
})

test.serial('Test provider time delta metric', async (t) => {
  const metricsAddress = `http://localhost:${process.env['METRICS_PORT']}/metrics`
  const response = await axios.get(metricsAddress)
  const metricsMap = parsePromMetrics(response.data)
  const expectedLabel = `{participant_id="test-|from:eth|to:usd",feed_id="|from:eth|to:usd",cache_type="local",app_name="TEST",app_version="${version}"}`
  t.is(metricsMap.get(`cache_data_max_age${expectedLabel}`), 90000)
})

test.serial('Test credit spent metrics', async (t) => {
  const metricsAddress = `http://localhost:${process.env['METRICS_PORT']}/metrics`
  const response = await axios.get(metricsAddress)
  const metricsMap = parsePromMetrics(response.data)
  const expectedLabel = `{feed_id="|from:eth|to:usd",participant_id="test-|from:eth|to:usd",app_name="TEST",app_version="${version}"}`
  t.is(metricsMap.get(`rate_limit_credits_spent_total${expectedLabel}`), 1)
})

test.serial('Test http requests total metrics (cache hit)', async (t) => {
  const metricsAddress = `http://localhost:${process.env['METRICS_PORT']}/metrics`
  nock(URL)
    .get(endpoint)
    .query({
      base: from,
      quote: to,
    })
    .reply(200, {
      price,
    })

  await axios.post(t.context.serverAddress, {
    data: {
      from,
      to,
    },
  })

  const response = await axios.get(metricsAddress)
  const metricsMap = parsePromMetrics(response.data)
  const expectedLabel = `{method="POST",feed_id="|from:eth|to:usd",status_code="200",type="cacheHit",app_name="TEST",app_version="${version}"}`
  t.is(metricsMap.get(`http_requests_total${expectedLabel}`), 1)
})

test.serial('Test cache get count metrics', async (t) => {
  const metricsAddress = `http://localhost:${process.env['METRICS_PORT']}/metrics`
  const response = await axios.get(metricsAddress)
  const metricsMap = parsePromMetrics(response.data)
  const expectedLabel = `{participant_id="test-|from:eth|to:usd",feed_id="|from:eth|to:usd",cache_type="local",app_name="TEST",app_version="${version}"}`
  t.is(metricsMap.get(`cache_data_get_count${expectedLabel}`), 1)
})

test.serial('Test cache get value metrics', async (t) => {
  const metricsAddress = `http://localhost:${process.env['METRICS_PORT']}/metrics`
  const response = await axios.get(metricsAddress)
  const metricsMap = parsePromMetrics(response.data)
  const expectedLabel = `{participant_id="test-|from:eth|to:usd",feed_id="|from:eth|to:usd",cache_type="local",app_name="TEST",app_version="${version}"}`
  t.is(metricsMap.get(`cache_data_get_values${expectedLabel}`), 1234)
})

test.serial('Test cache get staleness metrics', async (t) => {
  const metricsAddress = `http://localhost:${process.env['METRICS_PORT']}/metrics`
  const response = await axios.get(metricsAddress)
  const metricsMap = parsePromMetrics(response.data)
  const expectedLabel = `{participant_id="test-|from:eth|to:usd",feed_id="|from:eth|to:usd",cache_type="local",app_name="TEST",app_version="${version}"}`
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
