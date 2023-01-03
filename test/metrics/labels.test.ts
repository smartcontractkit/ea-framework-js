import test from 'ava'
import { priceEndpointInputParameters } from '../../src/adapter'
import { cacheMetricsLabel } from '../../src/cache/metrics'
import { AdapterConfig } from '../../src/config'
import { buildHttpRequestMetricsLabel } from '../../src/metrics'
import { HttpRequestType } from '../../src/metrics/constants'
import { connectionErrorLabels, messageSubsLabels } from '../../src/transports/metrics'
import { AdapterError } from '../../src/validation/error'

test('Generate cache label test', (t) => {
  const result = {
    participant_id: 'test-{"base":"ETH","quote":"BTC"}',
    feed_id: '{"base":"ETH","quote":"BTC"}',
    cache_type: 'local',
  }
  t.deepEqual(
    cacheMetricsLabel('test-{"base":"ETH","quote":"BTC"}', '{"base":"ETH","quote":"BTC"}', 'local'),
    result,
  )
})

test('Generate http request metrics label test (adapter error)', (t) => {
  const label = buildHttpRequestMetricsLabel(
    'test-{"base":"ETH","quote":"BTC"}',
    new AdapterError({
      metricsLabel: HttpRequestType.DP_ERROR,
      providerStatusCode: 500,
      statusCode: 200,
    }),
  )
  const result = {
    feed_id: 'test-{"base":"ETH","quote":"BTC"}',
    method: 'POST',
    status_code: 200,
    type: HttpRequestType.DP_ERROR,
    provider_status_code: 500,
  }
  label.type
  t.deepEqual(label, result)
})

test('Generate http request metrics label test (generic error)', (t) => {
  const label = buildHttpRequestMetricsLabel('test-{"base":"ETH","quote":"BTC"}', new Error('Test'))
  const result = {
    feed_id: 'test-{"base":"ETH","quote":"BTC"}',
    method: 'POST',
    status_code: 500,
    type: HttpRequestType.ADAPTER_ERROR,
  }
  label.type
  t.deepEqual(label, result)
})

test('Generate data provider metrics label test', (t) => {
  const result = {
    participant_id: 'test-{"base":"ETH","quote":"BTC"}',
    feed_id: '{"base":"ETH","quote":"BTC"}',
    cache_type: 'local',
  }
  t.deepEqual(
    cacheMetricsLabel('test-{"base":"ETH","quote":"BTC"}', '{"base":"ETH","quote":"BTC"}', 'local'),
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
    feed_id: '{"base":"ETH","quote":"BTC"}',
    subscription_key: 'test-{"base":"ETH","quote":"BTC"}',
  }
  t.deepEqual(
    messageSubsLabels(
      {
        adapterConfig: {} as AdapterConfig,
        inputParameters: priceEndpointInputParameters,
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
