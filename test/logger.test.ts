import test from 'ava'
import { expose } from '../src'
import { Adapter, AdapterEndpoint } from '../src/adapter'
import CensorList from '../src/util/censor/censor-list'
import { censor, colorFactory, COLORS } from '../src/util/logger'
import { NopTransport } from './util'
import { SettingsMap } from '../src/config'

test.before(async () => {
  const customSettings: SettingsMap = {
    API_KEY: {
      description: 'Test custom env var',
      type: 'string',
      sensitive: true,
    },
  }
  process.env['API_KEY'] = 'mock-api-key'
  const adapter = new Adapter({
    name: 'TEST',
    customSettings,
    endpoints: [
      new AdapterEndpoint({
        name: 'test',
        inputParameters: {},
        transport: new NopTransport(),
      }),
    ],
  })
  await expose(adapter)
})

test('properly builds censor list', async (t) => {
  const censorList = CensorList.getAll()
  // eslint-disable-next-line prefer-regex-literals
  t.deepEqual(censorList[0], { key: 'API_KEY', value: RegExp('mock\\-api\\-key', 'gi') })
})

test('properly redacts API_KEY (string)', async (t) => {
  const redacted = censor('mock-api-key', CensorList.getAll())
  t.is(redacted, '[API_KEY REDACTED]')
})

test('properly redacts API_KEY (string with added text)', async (t) => {
  const redacted = censor('Bearer mock-api-key', CensorList.getAll())
  t.is(redacted, 'Bearer [API_KEY REDACTED]')
})

test('properly redacts API_KEY (object)', async (t) => {
  const redacted = censor({ apiKey: 'mock-api-key' }, CensorList.getAll())
  t.deepEqual(redacted, { apiKey: '[API_KEY REDACTED]' })
})

test('properly redacts API_KEY (object with added text)', async (t) => {
  const redacted = censor({ apiKey: 'Bearer mock-api-key' }, CensorList.getAll())
  t.deepEqual(redacted, { apiKey: 'Bearer [API_KEY REDACTED]' })
})

test('properly redacts API_KEY (multiple nested values)', async (t) => {
  const redacted = censor(
    { apiKey: 'mock-api-key', config: { headers: { auth: 'mock-api-key' } } },
    CensorList.getAll(),
  )
  t.deepEqual(redacted, {
    apiKey: '[API_KEY REDACTED]',
    config: { headers: { auth: '[API_KEY REDACTED]' } },
  })
})

test('Test color factory', async (t) => {
  const nextColor = colorFactory(COLORS)
  for (let i = 0; i < COLORS.length; i++) {
    t.is(nextColor(), COLORS[i])
  }
  // Test that the colors cycle back
  t.is(nextColor(), COLORS[0])
})

test('properly handle circular references', async (t) => {
  const a = {
    b: {},
  }
  a.b = a
  const log = censor(a, CensorList.getAll())
  t.is(log, '[Unknown]')
})
