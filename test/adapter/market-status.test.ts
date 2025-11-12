import test from 'ava'
import '../../src/adapter'
import {
  MarketStatusEndpoint,
  marketStatusEndpointInputParametersDefinition,
  MarketStatusEndpointGenerics,
} from '../../src/adapter/market-status'
import { InputParameters } from '../../src/validation'
import { TestAdapter } from '../../src/util/testing-utils'
import { Adapter } from '../../src/adapter/basic'

import { Transport } from '../../src/transports'
import { ResponseCache } from '../../src/cache/response'

test('MarketStatusEndpoint - validates weekend', async (t) => {
  class MarketStatusTestTransport implements Transport<MarketStatusEndpointGenerics> {
    name!: string
    responseCache!: ResponseCache<MarketStatusEndpointGenerics>

    async initialize() {}

    async foregroundExecute() {
      return {
        data: {
          result: 2,
          statusString: 'OPEN',
        },
        result: 2,
        statusCode: 200,
        timestamps: {
          providerDataRequestedUnixMs: 0,
          providerDataReceivedUnixMs: 0,
          providerIndicatedTimeUnixMs: 0,
        },
      }
    }
  }

  const adapter = new Adapter({
    name: 'TEST',
    endpoints: [
      new MarketStatusEndpoint({
        name: 'test',
        inputParameters: new InputParameters(marketStatusEndpointInputParametersDefinition),
        transport: new MarketStatusTestTransport(),
      }),
    ],
  })

  const testAdapter = await TestAdapter.start(
    adapter,
    {} as {
      testAdapter: TestAdapter
    },
  )

  const response1 = await testAdapter.request({
    market: 'BTC',
    type: 'regular',
    endpoint: 'test',
  })
  t.is(response1.statusCode, 200, 'Should succeed with empty weekend when type is regular')

  const response2 = await testAdapter.request({
    market: 'BTC',
    type: 'regular',
    weekend: '520-020',
    endpoint: 'test',
  })
  t.is(response2.statusCode, 400, 'Should fail with weekend when type is regular')
  t.true(
    response2
      .json()
      .error.message.includes('[Param: weekend] must be empty when [Param: type] is regular'),
  )

  const response3 = await testAdapter.request({
    market: 'BTC',
    type: '24/5',
    weekend: '520-020',
    endpoint: 'test',
  })
  t.is(response3.statusCode, 400, 'Should fail with invalid weekend format when type is 24/5')
  t.true(response3.json().error.message.includes('[Param: weekend] does not match format'))

  const response4 = await testAdapter.request({
    market: 'BTC',
    type: '24/5',
    weekend: '520-020:America/New_York',
    endpoint: 'test',
  })
  t.is(response4.statusCode, 200, 'Should succeed with valid weekend when type is 24/5')

  await testAdapter.api.close()
})
