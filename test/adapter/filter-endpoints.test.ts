import test from 'ava'
import { Adapter, AdapterEndpoint } from '../../src/adapter'
import { LoggerFactoryProvider } from '../../src/util/logger'
import { NopTransport } from '../../src/util/testing-utils'

test.before(() => {
  LoggerFactoryProvider.set()
})

const makeEndpoint = (name: string) => new AdapterEndpoint({ name, transport: new NopTransport() })

test.afterEach(() => {
  delete process.env['ENABLED_ENDPOINTS']
})

test('loads all endpoints when ENABLED_ENDPOINTS is not set', (t) => {
  const adapter = new Adapter({
    name: 'TEST',
    endpoints: [makeEndpoint('price'), makeEndpoint('volume')],
  })
  t.is(adapter.endpoints.length, 2)
})

test('filters to only the named endpoints', (t) => {
  process.env['ENABLED_ENDPOINTS'] = 'price'
  const adapter = new Adapter({
    name: 'TEST',
    endpoints: [makeEndpoint('price'), makeEndpoint('volume')],
  })
  t.is(adapter.endpoints.length, 1)
  t.is(adapter.endpoints[0].name, 'price')
})

test('trims whitespace and lowercases names in ENABLED_ENDPOINTS', (t) => {
  process.env['ENABLED_ENDPOINTS'] = ' Price , VOLUME '
  const adapter = new Adapter({
    name: 'TEST',
    endpoints: [makeEndpoint('price'), makeEndpoint('volume')],
  })
  t.is(adapter.endpoints.length, 2)
})

test('throws when no endpoints match ENABLED_ENDPOINTS', (t) => {
  process.env['ENABLED_ENDPOINTS'] = 'nonexistent'
  t.throws(() => new Adapter({ name: 'TEST', endpoints: [makeEndpoint('price')] }), {
    message: /nonexistent/,
  })
})

test('clears defaultEndpoint when it is excluded by ENABLED_ENDPOINTS', (t) => {
  process.env['ENABLED_ENDPOINTS'] = 'volume'
  const adapter = new Adapter({
    name: 'TEST',
    defaultEndpoint: 'price',
    endpoints: [makeEndpoint('price'), makeEndpoint('volume')],
  })
  t.is(adapter.defaultEndpoint, undefined)
})

test('keeps defaultEndpoint when it is included in ENABLED_ENDPOINTS', (t) => {
  process.env['ENABLED_ENDPOINTS'] = 'price'
  const adapter = new Adapter({
    name: 'TEST',
    defaultEndpoint: 'price',
    endpoints: [makeEndpoint('price'), makeEndpoint('volume')],
  })
  t.is(adapter.defaultEndpoint, 'price')
})
