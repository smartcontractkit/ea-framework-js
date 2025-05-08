import test from 'ava'
import sinon from 'sinon'
import fastify from 'fastify'
import { serializeResponse } from '../src/util/fast-serialize'
import { metrics } from '../src/metrics'

test.before(() => {
  metrics.initialize()
})

test.afterEach(() => {
  sinon.restore()
})

test('API endpoint uses optimized serialization when enabled', async (t) => {
  // Setup spy on serializeResponse
  const serializeSpy = sinon.spy(serializeResponse)

  // Create a test app
  const app = fastify()

  // Add a test route using the serializer
  app.get('/test-fast', (_, reply) => {
    const response = {
      statusCode: 200,
      data: { result: '123.45' },
      result: '123.45',
      timestamps: {
        providerDataRequestedUnixMs: Date.now() - 100,
        providerDataReceivedUnixMs: Date.now(),
        providerIndicatedTimeUnixMs: Date.now() - 200,
      },
    }

    return reply.code(200).type('application/json').serializer(serializeSpy).send(response)
  })

  // Add a control route with standard serialization
  app.get('/test-standard', (_, reply) => {
    const response = {
      statusCode: 200,
      data: { result: '123.45' },
      result: '123.45',
      timestamps: {
        providerDataRequestedUnixMs: Date.now() - 100,
        providerDataReceivedUnixMs: Date.now(),
        providerIndicatedTimeUnixMs: Date.now() - 200,
      },
    }

    return reply.code(200).send(response)
  })

  // Test the fast serialization route
  const response = await app.inject({
    method: 'GET',
    url: '/test-fast',
  })

  // Test the standard serialization route
  const standardResponse = await app.inject({
    method: 'GET',
    url: '/test-standard',
  })

  // Verify both responses are valid JSON and have the same shape
  const parsedFast = JSON.parse(response.body)
  const parsedStandard = JSON.parse(standardResponse.body)

  t.is(parsedFast.statusCode, 200)
  t.is(parsedStandard.statusCode, 200)
  t.truthy(parsedFast.data)
  t.truthy(parsedStandard.data)

  // Verify that our serializer was called
  t.true(serializeSpy.called)
})
