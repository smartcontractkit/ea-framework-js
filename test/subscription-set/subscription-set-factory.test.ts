import test from 'ava'
import Redis from 'ioredis'
import { buildAdapterConfig } from '../../src/config'
import { SubscriptionSetFactory } from '../../src/util'
import { ExpiringSortedSet } from '../../src/util/subscription-set/expiring-sorted-set'
import { RedisSubscriptionSet } from '../../src/util/subscription-set/redis-sorted-set'
import { RedisMock } from '../util'

test('subscription set factory (local cache)', async (t) => {
  process.env['CACHE_TYPE'] = 'local'
  const config = buildAdapterConfig({})
  const factory = new SubscriptionSetFactory(config, 'test')
  const subscriptionSet = factory.buildSet('test')
  t.is(subscriptionSet instanceof ExpiringSortedSet, true)
})

test('subscription set factory (redis cache)', async (t) => {
  process.env['CACHE_TYPE'] = 'redis'
  const config = buildAdapterConfig({})
  const factory = new SubscriptionSetFactory(config, 'test', new RedisMock() as unknown as Redis)
  const subscriptionSet = factory.buildSet('test')
  t.is(subscriptionSet instanceof RedisSubscriptionSet, true)
})

test('subscription set factory (redis cache missing client)', async (t) => {
  process.env['CACHE_TYPE'] = 'redis'
  const config = buildAdapterConfig({})
  const factory = new SubscriptionSetFactory(config, 'test')
  try {
    factory.buildSet('test')
    t.fail()
  } catch (e: unknown) {
    t.pass()
  }
})
