import { groupArrayByKey, splitArrayIntoChunks } from '../src/util'
import test from 'ava'

test('Test splitArrayIntoChunks function', async (t) => {
  const array = [1, 2, 3, 4, 5]
  let chunks = splitArrayIntoChunks(array, 2)
  t.deepEqual(chunks, [[1,2], [3,4], [5]])

  // Size greater than array length returns whole array
  chunks = splitArrayIntoChunks(array, 10)
  t.deepEqual(chunks, [[1, 2, 3, 4, 5]])

  chunks = splitArrayIntoChunks([], 10)
  t.deepEqual(chunks, [[]])

})


test('Test groupArrayByKey function', async (t) => {
  const array = [{base: 'BTC', quote: 'ETH'}, {base: 'BTC', quote: 'USD'}, {base: 'LTC', quote: 'DASH'}]
  let grouped = groupArrayByKey(array, 'base')
  t.deepEqual(grouped, {
    BTC: [{base: 'BTC', quote: 'ETH'}, {base: 'BTC', quote: 'USD'}],
    LTC: [{base: 'LTC', quote: 'DASH'}]
  })

  grouped = groupArrayByKey(array, 'quote')

  t.deepEqual(grouped, {
    ETH: [{base: 'BTC', quote: 'ETH'}],
    USD: [{base: 'BTC', quote: 'USD'}],
    DASH: [{base: 'LTC', quote: 'DASH'}]
  })
})