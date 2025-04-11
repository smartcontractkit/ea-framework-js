import test from 'ava'
import { allowedUndefinedStubProps, makeStub } from '../../src/util/testing-utils'

test('make a stub', async (t) => {
  const stub = makeStub('stub', {
    name: 'stub-name',
    count: 5,
  })

  t.is(stub.name, 'stub-name')
  t.is(stub.count, 5)
})

test('make a stub with nested fields', async (t) => {
  const stub = makeStub('stub', {
    name: 'stub-name',
    nested: {
      count: 5,
    },
  })

  t.is(stub.name, 'stub-name')
  t.is(stub.nested.count, 5)
})

test('accessing an absent field should throw an error', async (t) => {
  const stub = makeStub('stub', {
    name: 'stub-name',
    nested: {
      count: 5,
    },
  })

  t.throws(
    () => {
      // @ts-expect-error intended
      t.is(stub.count, undefined)
    },
    {
      message: "Property 'stub.count' does not exist",
    },
  )
})

test('accessing a nested absent field should throw an error', async (t) => {
  const stub = makeStub('stub', {
    name: 'stub-name',
    nested: {
      count: 5,
    },
  })

  t.throws(
    () => {
      // @ts-expect-error intended
      t.is(stub.nested.name, undefined)
    },
    {
      message: "Property 'stub.nested.name' does not exist",
    },
  )
})

test('fields used by jest are allowed to be undefined', async (t) => {
  const stub = makeStub('stub', {
    name: 'stub-name',
    count: 5,
  })

  // @ts-expect-error intended
  t.is(stub.nodeType, undefined)
  // @ts-expect-error intended
  t.is(stub.tagName, undefined)
})

test('Symbol props are allowed to be undefined', async (t) => {
  const stub = makeStub('stub', {
    name: 'stub-name',
    count: 5,
  })

  // @ts-expect-error intended
  t.is(stub[Symbol('my symbol')], undefined)
})

test('allowedUndefinedStubProps can be extended and restored', async (t) => {
  const customProp = 'myCustomProp'

  const stub = makeStub('stub', {
    name: 'stub-name',
    count: 5,
  })

  t.throws(
    () => {
      // @ts-expect-error intended
      t.is(stub[customProp], undefined)
    },
    {
      message: "Property 'stub.myCustomProp' does not exist",
    },
  )

  allowedUndefinedStubProps.push('myCustomProp')

  // @ts-expect-error intended
  t.is(stub[customProp], undefined)

  allowedUndefinedStubProps.pop()

  t.throws(
    () => {
      // @ts-expect-error intended
      t.is(stub[customProp], undefined)
    },
    {
      message: "Property 'stub.myCustomProp' does not exist",
    },
  )
})
