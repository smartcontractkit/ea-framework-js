import test from 'ava'
import {
  allowedUndefinedStubProps,
  makeStub,
  runAllUntil,
  runAllUntilSettled,
  runAllUntilTime,
} from '../../src/util/testing-utils'
import { sleep } from '../../src/util'
import { installTimers } from '../helper'

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

test.serial('runAllUntil returns immediately when isComplete is initially true', async (t) => {
  const clock = installTimers()
  try {
    const startTime = clock.now
    let callCount = 0

    await runAllUntil(clock, () => {
      callCount++
      return true
    })

    t.is(callCount, 1)
    t.is(clock.now, startTime)
  } finally {
    clock.uninstall()
  }
})

test.serial(
  'runAllUntil advances clock through timers until isComplete returns true',
  async (t) => {
    const clock = installTimers()
    try {
      let counter = 0
      const interval = setInterval(() => {
        counter++
      }, 100)

      await runAllUntil(clock, () => counter >= 3)
      clearInterval(interval)

      t.is(counter, 3)
      t.is(clock.now, 300)
    } finally {
      clock.uninstall()
    }
  },
)

test.serial('runAllUntil does not advance time unnecessarily', async (t) => {
  const clock = installTimers()
  try {
    let counter = 0
    Promise.resolve().then(() => {
      counter++
    })
    sleep(10) // Give runAllUntil a timer to advance to, although it shouldn't.
    t.is(counter, 0)
    await runAllUntil(clock, () => counter === 1)
    t.is(counter, 1)
    t.is(clock.now, 0)
  } finally {
    clock.uninstall()
  }
})

test.serial(
  'runAllUntilTime advances clock by the specified amount and runs scheduled callbacks',
  async (t) => {
    const clock = installTimers()
    try {
      const fired: string[] = []
      setTimeout(() => fired.push('100'), 100)
      setTimeout(() => fired.push('200'), 200)
      setTimeout(() => fired.push('400'), 400)

      await runAllUntilTime(clock, 250)

      t.deepEqual(fired, ['100', '200'])
      t.is(clock.now, 250)
    } finally {
      clock.uninstall()
    }
  },
)

test.serial(
  'runAllUntilSettled advances clock until the promise settles and returns its value',
  async (t) => {
    const clock = installTimers()
    try {
      const promise = new Promise<string>((resolve) => {
        setTimeout(() => resolve('done'), 500)
      })

      const result = await runAllUntilSettled(clock, promise)

      t.is(result, 'done')
      t.is(clock.now, 500)
    } finally {
      clock.uninstall()
    }
  },
)

test.serial(
  'runAllUntilSettled advances clock until the promise rejects and re-throws',
  async (t) => {
    const clock = installTimers()
    try {
      const promise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('boom')), 500)
      })

      await t.throwsAsync(() => runAllUntilSettled(clock, promise), { message: 'boom' })
      t.is(clock.now, 500)
    } finally {
      clock.uninstall()
    }
  },
)

test.serial('runAllUntilSettled should not advance time unnecessarily', async (t) => {
  const clock = installTimers()
  try {
    let done = false
    const promise = new Promise<void>((resolve) => {
      Promise.resolve().then(() => {
        done = true
        resolve()
      })
    })
    sleep(10) // Give runAllUntil a timer to advance to, although it shouldn't.

    t.is(done, false)
    await runAllUntilSettled(clock, promise)
    t.is(done, true)
    t.is(clock.now, 0)
  } finally {
    clock.uninstall()
  }
})
