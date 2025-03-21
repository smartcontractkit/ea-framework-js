import {
  groupArrayByKey,
  splitArrayIntoChunks,
  getCanonicalAdapterName,
  canonicalizeAdapterNameKeys,
} from '../src/util'
import test from 'ava'

test('Test splitArrayIntoChunks function', async (t) => {
  const array = [1, 2, 3, 4, 5]
  let chunks = splitArrayIntoChunks(array, 2)
  t.deepEqual(chunks, [[1, 2], [3, 4], [5]])

  // Size greater than array length returns whole array
  chunks = splitArrayIntoChunks(array, 10)
  t.deepEqual(chunks, [[1, 2, 3, 4, 5]])

  chunks = splitArrayIntoChunks([], 10)
  t.deepEqual(chunks, [[]])
})

test('Test groupArrayByKey function', async (t) => {
  const array = [
    { base: 'BTC', quote: 'ETH' },
    { base: 'BTC', quote: 'USD' },
    { base: 'LTC', quote: 'DASH' },
  ]
  let grouped = groupArrayByKey(array, 'base')
  t.deepEqual(grouped, {
    BTC: [
      { base: 'BTC', quote: 'ETH' },
      { base: 'BTC', quote: 'USD' },
    ],
    LTC: [{ base: 'LTC', quote: 'DASH' }],
  })

  grouped = groupArrayByKey(array, 'quote')

  t.deepEqual(grouped, {
    ETH: [{ base: 'BTC', quote: 'ETH' }],
    USD: [{ base: 'BTC', quote: 'USD' }],
    DASH: [{ base: 'LTC', quote: 'DASH' }],
  })
})

test('Test getCanonicalAdapterName', async (t) => {
  t.is(getCanonicalAdapterName(undefined), undefined)
  t.is(getCanonicalAdapterName('test'), 'test')
  t.is(getCanonicalAdapterName('TEST'), 'test')
  t.is(getCanonicalAdapterName('TEST-adapter'), 'test_adapter')
  t.is(getCanonicalAdapterName('TEST_ADAPTER'), 'test_adapter')
  t.is(getCanonicalAdapterName('A-B-C-D-e-f'), 'a_b_c_d_e_f')
})

test('Test canonicalizeAdapterNameKeys', async (t) => {
  t.deepEqual(canonicalizeAdapterNameKeys(undefined), undefined)
  t.deepEqual(
    canonicalizeAdapterNameKeys({
      test: 1,
      TEST2: 2,
      'TEST-adapter': 3,
      TEST_ADAPTER2: 4,
      'A-B-C-D-e-f': 5,
    }),
    {
      test: 1,
      test2: 2,
      test_adapter: 3,
      test_adapter2: 4,
      a_b_c_d_e_f: 5,
    },
  )
})
