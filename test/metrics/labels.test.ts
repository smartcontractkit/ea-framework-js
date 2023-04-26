import test from 'ava'
import { priceEndpointInputParametersDefinition } from '../../src/adapter'
import { cacheMetricsLabel } from '../../src/cache/metrics'
import { AdapterSettings } from '../../src/config'
import { buildHttpRequestMetricsLabel } from '../../src/metrics'
import { HttpRequestType } from '../../src/metrics/constants'
import { connectionErrorLabels, messageSubsLabels } from '../../src/transports/metrics'
import { InputParameters } from '../../src/validation'
import { AdapterError } from '../../src/validation/error'

test('Generate cache label test', (t) => {
  const result = {
    participant_id: 'test-{"base":"eth","quote":"btc"}',
    feed_id: '{"base":"eth","quote":"btc"}',
    cache_type: 'local',
  }
  t.deepEqual(
    cacheMetricsLabel('test-{"base":"eth","quote":"btc"}', '{"base":"eth","quote":"btc"}', 'local'),
    result,
  )
})

test('Generate http request metrics label test (adapter error)', (t) => {
  const label = buildHttpRequestMetricsLabel(
    'test-{"base":"eth","quote":"btc"}',
    new AdapterError({
      metricsLabel: HttpRequestType.DP_ERROR,
      providerStatusCode: 500,
      statusCode: 200,
    }),
  )
  const result = {
    feed_id: 'test-{"base":"eth","quote":"btc"}',
    method: 'POST',
    status_code: 200,
    type: HttpRequestType.DP_ERROR,
    provider_status_code: 500,
  }
  t.deepEqual(label, result)
})

test('Generate http request metrics label test (generic error)', (t) => {
  const label = buildHttpRequestMetricsLabel('test-{"base":"eth","quote":"btc"}', new Error('Test'))
  const result = {
    feed_id: 'test-{"base":"eth","quote":"btc"}',
    method: 'POST',
    status_code: 500,
    type: HttpRequestType.ADAPTER_ERROR,
  }
  t.deepEqual(label, result)
})

test('Generate data provider metrics label test', (t) => {
  const result = {
    participant_id: 'test-{"base":"eth","quote":"btc"}',
    feed_id: '{"base":"eth","quote":"btc"}',
    cache_type: 'local',
  }
  t.deepEqual(
    cacheMetricsLabel('test-{"base":"eth","quote":"btc"}', '{"base":"eth","quote":"btc"}', 'local'),
    result,
  )
})

test('Generate WS connection error label test', (t) => {
  const result = {
    message: 'error',
  }
  t.deepEqual(connectionErrorLabels('error'), result)
})

test('Generate WS message and subscription label test', (t) => {
  const result = {
    feed_id: '{"base":"eth","quote":"btc"}',
    subscription_key: 'test-{"base":"eth","quote":"btc"}',
  }
  t.deepEqual(
    messageSubsLabels(
      {
        adapterSettings: {} as AdapterSettings,
        inputParameters: new InputParameters(priceEndpointInputParametersDefinition),
        endpointName: 'test',
      },
      {
        base: 'ETH',
        quote: 'BTC',
      },
    ),
    result,
  )
})
