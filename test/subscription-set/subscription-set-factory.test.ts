import test from 'ava'
import Redis from 'ioredis'
import { buildAdapterSettings } from '../../src/config'
import { metrics } from '../../src/metrics'
import { LoggerFactoryProvider, SubscriptionSetFactory } from '../../src/util'
import { ExpiringSortedSet } from '../../src/util/subscription-set/expiring-sorted-set'
import { RedisSubscriptionSet } from '../../src/util/subscription-set/redis-sorted-set'
import { RedisMock } from '../../src/util/testing-utils'

test.before(() => {
  LoggerFactoryProvider.set()
  metrics.initialize()
})

test('subscription set factory (local cache)', async (t) => {
  process.env['CACHE_TYPE'] = 'local'
  const config = buildAdapterSettings({})
  const factory = new SubscriptionSetFactory(config, 'test')
  const subscriptionSet = factory.buildSet('test', 'test')
  t.is(subscriptionSet instanceof ExpiringSortedSet, true)
})

test('redis subscription set reports whether it has entries', async (t) => {
  const redis = {
    exists: async (key: string) => (key === 'present' ? 1 : 0),
  } as unknown as Redis

  t.true(await new RedisSubscriptionSet<number>(redis, 'present', true).hasEntries())
  t.false(await new RedisSubscriptionSet<number>(redis, 'missing', true).hasEntries())
})

test('subscription set factory (redis cache)', async (t) => {
  process.env['CACHE_TYPE'] = 'redis'
  const config = buildAdapterSettings({})
  const factory = new SubscriptionSetFactory(config, 'test', new RedisMock() as unknown as Redis)
  const subscriptionSet = factory.buildSet('test', 'test')
  t.is(subscriptionSet instanceof RedisSubscriptionSet, true)
  const value = subscriptionSet.get('testKey')
  t.is(value, undefined)
})

test('subscription set factory (redis cache missing client)', async (t) => {
  process.env['CACHE_TYPE'] = 'redis'
  const config = buildAdapterSettings({})
  const factory = new SubscriptionSetFactory(config, 'test')
  try {
    factory.buildSet('test', 'test')
    t.fail()
  } catch (_) {
    t.pass()
  }
})

test('inversion subscription sets use distinct Redis keys', async (t) => {
  process.env['CACHE_TYPE'] = 'redis'
  const config = buildAdapterSettings({})
  const keys: string[] = []
  const expirations: { key: string; ttl: number }[] = []
  const redis = {
    zadd: async (key: string) => {
      keys.push(key)
    },
    pexpire: async (key: string, ttl: number) => {
      expirations.push({ key, ttl })
    },
  } as unknown as Redis
  const factory = new SubscriptionSetFactory(config, 'TEST', redis)

  await factory.buildSet('endpoint', 'transport').add('raw', 1000, 'raw')
  await factory
    .buildSet('endpoint', 'transport', 'inversion-single-value-v1')
    .add('inverse', 1000, 'inverse')
  await factory
    .buildSet('endpoint', 'transport', 'inversion-single-value-v2')
    .add('inverse-v2', 1000, 'inverse-v2')

  t.true(keys[0].endsWith('TEST-endpoint-transport-subscriptionSet'))
  t.true(keys[1].endsWith('TEST-endpoint-transport-inversion-single-value-v1-subscriptionSet'))
  t.true(keys[2].endsWith('TEST-endpoint-transport-inversion-single-value-v2-subscriptionSet'))
  t.not(keys[1], keys[2])
  t.deepEqual(expirations, [
    { key: keys[1], ttl: 1000 },
    { key: keys[2], ttl: 1000 },
  ])
})

test('subscription set factory (local cache) max capacity', async (t) => {
  process.env['CACHE_TYPE'] = 'local'
  process.env['SUBSCRIPTION_SET_MAX_ITEMS'] = '3'
  const config = buildAdapterSettings({})
  const factory = new SubscriptionSetFactory(config, 'test')
  const subscriptionSet = factory.buildSet('test', 'test')

  await subscriptionSet.add(1, 10000, '1')
  await subscriptionSet.add(2, 10000, '2')
  await subscriptionSet.add(3, 10000, '3')
  await subscriptionSet.add(4, 10000, '4')

  const value1 = await subscriptionSet.get('1')
  const value2 = await subscriptionSet.get('2')
  const value3 = await subscriptionSet.get('3')
  const value4 = await subscriptionSet.get('4')

  t.is(value1, undefined)
  t.is(value2, 2)
  t.is(value3, 3)
  t.is(value4, 4)

  const allValues = await subscriptionSet.getAll()
  t.deepEqual(allValues, [2, 3, 4])
})
