import { NopTransport } from '../src/util/testing-utils'
import test from 'ava'
import { InputParameters } from '../src/validation'
import {
  DEFAULT_LWBA_ALIASES,
  LwbaEndpoint,
  LwbaEndpointGenerics,
  lwbaEndpointInputParametersDefinition,
} from '../src/adapter'
import { TimestampedProviderErrorResponse, TimestampedProviderResult } from '../src/util'

type LwbaResultValidator = (
  result: TimestampedProviderResult<LwbaEndpointGenerics>,
) => TimestampedProviderResult<LwbaEndpointGenerics>

const getResultValidator = (endpoint: LwbaEndpoint<LwbaEndpointGenerics>): LwbaResultValidator =>
  (endpoint as unknown as { resultValidator: LwbaResultValidator }).resultValidator

const buildLwbaEndpoint = () =>
  new LwbaEndpoint({
    name: 'lwba_test',
    inputParameters: new InputParameters(lwbaEndpointInputParametersDefinition),
    transport: new NopTransport(),
  }) as LwbaEndpoint<LwbaEndpointGenerics>

test('lwba price endpoint has common aliases', async (t) => {
  const lwbaEndpoint = new LwbaEndpoint({
    name: 'test',
    inputParameters: new InputParameters(lwbaEndpointInputParametersDefinition),
    transport: new NopTransport(),
  }) as LwbaEndpoint<LwbaEndpointGenerics>

  t.deepEqual(lwbaEndpoint.aliases, DEFAULT_LWBA_ALIASES)
})

test('Valid LWBA response passes validation via resultValidator', (t) => {
  const lwbaEndpoint = buildLwbaEndpoint()

  const result = getResultValidator(lwbaEndpoint)({
    params: { base: 'BTC', quote: 'USD' },
    response: {
      result: null,
      data: {
        bid: 123.1,
        mid: 123.2,
        ask: 123.3,
      },
      timestamps: {
        providerDataRequestedUnixMs: 0,
        providerDataReceivedUnixMs: 0,
        providerIndicatedTimeUnixMs: undefined,
      },
    },
  })

  t.deepEqual(result.response.data, {
    bid: 123.1,
    mid: 123.2,
    ask: 123.3,
  })
})

test('Invariant violation fails LWBA validation via resultValidator (bid <= mid <= ask)', (t) => {
  const lwbaEndpoint = buildLwbaEndpoint()

  const result = getResultValidator(lwbaEndpoint)({
    params: { base: 'BTC', quote: 'USD' },
    response: {
      result: null,
      data: {
        bid: 123.1,
        mid: 123.4,
        ask: 123.3,
      },
      timestamps: {
        providerDataRequestedUnixMs: 0,
        providerDataReceivedUnixMs: 0,
        providerIndicatedTimeUnixMs: undefined,
      },
    },
  })

  const written = result.response as TimestampedProviderErrorResponse
  t.is(written.statusCode, 502)
  t.true(
    written.errorMessage.includes(
      'Invariant violation. Mid price must be between bid and ask prices.',
    ),
  )
})

test('Invariant violation fails LWBA validation via resultValidator (bid, mid or ask not found)', (t) => {
  const lwbaEndpoint = buildLwbaEndpoint()

  const result = getResultValidator(lwbaEndpoint)({
    params: { base: 'BTC', quote: 'USD' },
    response: {
      result: null,
      data: {
        bid: null as never,
        mid: 123.4,
        ask: 123.3,
      },
      timestamps: {
        providerDataRequestedUnixMs: 0,
        providerDataReceivedUnixMs: 0,
        providerIndicatedTimeUnixMs: undefined,
      },
    },
  })

  const written = result.response as TimestampedProviderErrorResponse
  t.is(written.statusCode, 502)
  t.true(
    written.errorMessage.includes(
      'Invariant violation. LWBA response must contain mid, bid and ask prices.',
    ),
  )
})
