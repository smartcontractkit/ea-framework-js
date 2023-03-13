import FakeTimers, { InstalledClock } from '@sinonjs/fake-timers'
import untypedTest, { TestFn } from 'ava'
import axios from 'axios'
import MockAdapter from 'axios-mock-adapter'
import { Adapter, AdapterEndpoint } from '../../src/adapter'
import { AdapterConfig, BaseAdapterSettings } from '../../src/config'
import { retrieveCost } from '../../src/metrics'
import { HttpTransport } from '../../src/transports'
import { TestAdapter } from '../util'

const test = untypedTest as TestFn<{
  testAdapter: TestAdapter
  clock: InstalledClock
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
  Settings: BaseAdapterSettings
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

test.before(async (t) => {
  t.context.clock = FakeTimers.install()
  process.env['METRICS_ENABLED'] = 'true'
  const config = new AdapterConfig(
    {},
    {
      envDefaultOverrides: {
        RATE_LIMIT_CAPACITY_SECOND: 10,
      },
    },
  )
  const adapter = new Adapter({
    name: 'TEST',
    defaultEndpoint: 'test',
    config,
    endpoints: [createAdapterEndpoint()],
  })

  t.context.testAdapter = await TestAdapter.start(adapter, t.context)
})

const axiosMock = new MockAdapter(axios, {
  onNoMatch: 'throwException',
  delayResponse: 1,
})

const feed_id = '{\\"from\\":\\"eth\\",\\"to\\":\\"usd\\"}'

test.serial('test basic metrics', async (t) => {
  axiosMock
    .onGet(`${URL}/price`, {
      base: from,
      quote: to,
    })
    .reply(200, {
      price,
    })

  await t.context.testAdapter.request({ from, to })

  let metrics = await t.context.testAdapter.getMetrics()
  metrics.assert(t, {
    name: 'http_requests_total',
    labels: {
      method: 'POST',
      feed_id,
      provider_status_code: '200',
      status_code: '200',
      type: 'dataProviderHit',
    },
    expectedValue: 1,
  })
  // Test http request duration metrics
  metrics.assertPositiveNumber(t, {
    name: 'http_request_duration_seconds_sum',
  })

  // Test data provider requests metrics
  metrics.assert(t, {
    name: 'data_provider_requests',
    labels: {
      provider_status_code: '200',
      method: 'GET',
    },
    expectedValue: 10,
  })
  // Test data provider request duration metrics
  metrics.assertPositiveNumber(t, {
    name: 'data_provider_request_duration_seconds_sum',
  })

  // Test cache set count metrics
  metrics.assert(t, {
    name: 'cache_data_set_count',
    labels: {
      feed_id,
      participant_id: `TEST-test-default_single_transport-${feed_id}`,
      cache_type: 'local',
    },
    expectedValue: 10,
  })
  // Test cache max age metrics
  metrics.assert(t, {
    name: 'cache_data_max_age',
    labels: {
      feed_id,
      participant_id: `TEST-test-default_single_transport-${feed_id}`,
      cache_type: 'local',
    },
    expectedValue: 90000,
  })
  // Test cache set staleness metrics
  metrics.assert(t, {
    name: 'cache_data_staleness_seconds',
    labels: {
      feed_id,
      participant_id: `TEST-test-default_single_transport-${feed_id}`,
      cache_type: 'local',
    },
    expectedValue: 0,
  })

  // Test provider time delta metric
  metrics.assert(t, {
    name: 'provider_time_delta',
    labels: {
      feed_id,
    },
    expectedValue: 100,
  })
  // Test credit spent metrics
  metrics.assert(t, {
    name: 'rate_limit_credits_spent_total',
    labels: {
      feed_id: 'N/A',
      participant_id: '9002',
    },
    expectedValue: 10,
  })
  // Test http requests total metrics (cache hit)
  axiosMock
    .onGet(`${URL}/price`, {
      base: from,
      quote: to,
    })
    .reply(200, {
      price,
    })

  await t.context.testAdapter.request({ from, to })

  metrics = await t.context.testAdapter.getMetrics()
  metrics.assert(t, {
    name: 'http_requests_total',
    labels: {
      method: 'POST',
      feed_id,
      status_code: '200',
      type: 'cacheHit',
    },
    expectedValue: 1,
  })
  // Test cache get count metrics
  metrics.assert(t, {
    name: 'cache_data_get_count',
    labels: {
      feed_id,
      participant_id: `TEST-test-default_single_transport-${feed_id}`,
      cache_type: 'local',
    },
    expectedValue: 1,
  })
  // Test cache get value metrics
  metrics.assert(t, {
    name: 'cache_data_get_values',
    labels: {
      feed_id,
      participant_id: `TEST-test-default_single_transport-${feed_id}`,
      cache_type: 'local',
    },
    expectedValue: 1234,
  })
  // Test cache get staleness metrics
  metrics.assertPositiveNumber(t, {
    name: 'cache_data_staleness_seconds',
    labels: {
      feed_id,
      participant_id: `TEST-test-default_single_transport-${feed_id}`,
      cache_type: 'local',
    },
  })
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
