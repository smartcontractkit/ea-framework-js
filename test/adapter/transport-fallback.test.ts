import untypedTest, { TestFn } from 'ava'
import { Adapter, AdapterEndpoint } from '../../src/adapter'
import { AdapterConfig } from '../../src/config'
import { TransportRoutes } from '../../src/transports'
import { AdapterRequest } from '../../src/util'
import { NopTransport, NopTransportTypes, TestAdapter } from '../../src/util/testing-utils'

const test = untypedTest as TestFn<{ testAdapter: TestAdapter }>

test.afterEach(async (t) => {
  await t.context.testAdapter?.api.close()
})

function tsResponse(result: unknown) {
  return {
    data: null,
    statusCode: 200,
    result: result as null,
    timestamps: {
      providerDataRequestedUnixMs: 0,
      providerDataReceivedUnixMs: 0,
      providerIndicatedTimeUnixMs: 0,
    },
  }
}

function buildFallbackAdapter(
  primary: NopTransport<NopTransportTypes>,
  fallback: NopTransport<NopTransportTypes>,
) {
  const config = new AdapterConfig(
    {},
    {
      envDefaultOverrides: {
        TRANSPORT_FALLBACK_ENABLED: true,
      },
    },
  )
  return new Adapter({
    name: 'TEST',
    defaultEndpoint: 'price',
    config,
    endpoints: [
      new AdapterEndpoint<NopTransportTypes>({
        name: 'price',
        transportRoutes: new TransportRoutes<NopTransportTypes>()
          .register('primary', primary)
          .register('fallback', fallback),
        defaultTransport: 'primary',
        fallbackTransport: { primary: 'fallback' },
      }),
    ],
  })
}

test.serial('uses primary transport when it returns before fallback', async (t) => {
  const adapter = buildFallbackAdapter(
    new (class extends NopTransport<NopTransportTypes> {
      override async foregroundExecute(_req: AdapterRequest<NopTransportTypes['Parameters']>) {
        return tsResponse('primary')
      }
    })(),
    new (class extends NopTransport<NopTransportTypes> {
      override async foregroundExecute(_req: AdapterRequest<NopTransportTypes['Parameters']>) {
        await new Promise((r) => {
          setTimeout(r, 500)
        })
        return tsResponse('fallback')
      }
    })(),
  )

  const testAdapter = await TestAdapter.start(adapter, t.context)
  const started = Date.now()
  const response = await testAdapter.request({})
  t.is(response.statusCode, 200)
  t.is(response.json().result, 'primary')
  t.true(Date.now() - started < 200, 'should not wait for slow fallback path')
})

test.serial('uses fallback when primary does not return data', async (t) => {
  const adapter = buildFallbackAdapter(
    new NopTransport(),
    new (class extends NopTransport<NopTransportTypes> {
      override async foregroundExecute(_req: AdapterRequest<NopTransportTypes['Parameters']>) {
        return tsResponse('from-fallback')
      }
    })(),
  )

  const testAdapter = await TestAdapter.start(adapter, t.context)
  const response = await testAdapter.request({})

  t.is(response.statusCode, 200)
  t.is(response.json().result, 'from-fallback')
})

test.serial('returns timeout when primary and fallback both fail', async (t) => {
  const adapter = buildFallbackAdapter(new NopTransport(), new NopTransport())

  const testAdapter = await TestAdapter.start(adapter, t.context)
  const response = await testAdapter.request({})

  t.is(response.statusCode, 504)
  t.is(
    response.json().error.message,
    'The EA has not received any values from the Data Provider for the requested data yet. Retry after a short delay, and if the problem persists raise this issue in the relevant channels.',
  )
})
