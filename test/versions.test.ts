import untypedTest, { TestFn } from 'ava'
import { Adapter, AdapterEndpoint } from '../src/adapter'
import { EmptyCustomSettings } from '../src/config'
import { AdapterRequest, AdapterResponse, getVersions } from '../src/util'
import { NopTransport, TestAdapter } from '../src/util/testing-utils'
import { EmptyInputParameters, TypeFromDefinition } from '../src/validation/input-params'

const test = untypedTest as TestFn<{
  testAdapter: TestAdapter
}>

const price = 1234

type VersionTestTransportTypes = {
  Parameters: EmptyInputParameters
  Response: {
    Data: { result: number }
    Result: number
  }
  Settings: EmptyCustomSettings
}

/**
 * Writes the response to the cache and also returns it directly, so the first request is served by
 * the transport's immediate response and any subsequent one is served from the cache. Both paths go
 * through the same egress point, which is what these tests are about.
 */
class VersionTestTransport extends NopTransport<VersionTestTransportTypes> {
  override async foregroundExecute(
    req: AdapterRequest<TypeFromDefinition<EmptyInputParameters>>,
  ): Promise<AdapterResponse<VersionTestTransportTypes['Response']>> {
    const response = {
      data: { result: price },
      result: price,
      timestamps: {
        providerDataRequestedUnixMs: 0,
        providerDataReceivedUnixMs: 0,
        providerIndicatedTimeUnixMs: undefined,
      },
    }

    await this.responseCache.write(this.name, [{ params: req.requestContext.data, response }])

    return { ...response, statusCode: 200 }
  }
}

test.beforeEach(async (t) => {
  const adapter = new Adapter({
    name: 'TEST',
    defaultEndpoint: 'test',
    endpoints: [
      new AdapterEndpoint({
        name: 'test',
        transport: new VersionTestTransport(),
      }),
    ],
  })

  t.context.testAdapter = await TestAdapter.startWithMockedCache(adapter, t.context)
})

test.afterEach(async (t) => {
  await t.context.testAdapter?.api.close()
})

test.serial('successful response includes the adapter and framework versions', async (t) => {
  const response = await t.context.testAdapter.request({})

  t.is(response.statusCode, 200)
  t.deepEqual(response.json().meta.versions, getVersions())
})

test.serial('response metadata is populated even when metrics are disabled', async (t) => {
  // METRICS_ENABLED is false for this test suite, so the response cache leaves "meta" unset and the
  // egress helper is what fills all of this in
  const response = await t.context.testAdapter.request({})

  t.deepEqual(response.json().meta, {
    adapterName: 'TEST',
    transportName: 'default_single_transport',
    versions: getVersions(),
  })
})

test.serial('cached response includes the versions of the instance serving it', async (t) => {
  // First request populates the cache and is served by the transport's immediate response
  await t.context.testAdapter.request({})
  // Second request is served from the cache
  const cached = await t.context.testAdapter.request({})

  t.is(cached.statusCode, 200)
  t.deepEqual(cached.json().meta.versions, getVersions())
})

test.serial('serving a response does not write versions back into the cache', async (t) => {
  // The second request is served straight from the cache, which is where a mutating egress helper
  // would leak metadata into the cached object
  await t.context.testAdapter.request({})
  await t.context.testAdapter.request({})

  const cachedEntries = [...t.context.testAdapter.mockCache!.cache.values()].map(
    (node) => node.data.value as AdapterResponse,
  )

  t.true(cachedEntries.length > 0)
  for (const entry of cachedEntries) {
    // Cache entries are shared across instances and outlive deployments, so they must not carry the
    // version of whichever instance happened to serve a request from them
    t.is(entry.meta, undefined)
  }
})
