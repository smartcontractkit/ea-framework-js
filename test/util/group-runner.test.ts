import { deferredPromise, sleep } from '../../src/util'
import { GroupRunner } from '../../src/util/group-runner'
import test from 'ava'

type Task<T> = {
  promise: Promise<T>
  resolve: (arg: T) => void
  reject: (arg: any) => void
  getCallCount: () => number
  callback: () => Promise<T>
}

const createTask = <T>(n: number = -1): Task<T> => {
  const [promise, resolve, reject] = deferredPromise<T>()
  let callCount = 0
  return {
    promise,
    resolve,
    reject,
    getCallCount: () => callCount,
    callback: () => {
      callCount++
      return promise
    },
  }
}

test('should run tasks', async (t) => {
  const runner = new GroupRunner(2)
  const result = 'result'
  const callback = () => Promise.resolve(result)
  t.is(await runner.run(callback), result)
})

test('should wait after group size is reached', async (t) => {
  const runner = new GroupRunner(2)

  const tasks: Task<void>[] = []
  for (let i = 0; i < 3; i++) {
    tasks.push(createTask())
  }

  runner.run(tasks[0].callback)
  runner.run(tasks[1].callback)
  runner.run(tasks[2].callback)
  await sleep(0)
  t.is(tasks[0].getCallCount(), 1)
  t.is(tasks[1].getCallCount(), 1)
  t.is(tasks[2].getCallCount(), 0)
})

test('should continue after group has finished', async (t) => {
  const runner = new GroupRunner(2)

  const tasks: Task<void>[] = []
  for (let i = 0; i < 3; i++) {
    tasks.push(createTask())
  }

  runner.run(tasks[0].callback)
  runner.run(tasks[1].callback)
  runner.run(tasks[2].callback)

  await sleep(0)
  t.is(tasks[2].getCallCount(), 0)

  tasks[0].resolve(undefined)

  await sleep(0)
  t.is(tasks[2].getCallCount(), 0)

  tasks[1].resolve(undefined)

  await sleep(0)
  t.is(tasks[2].getCallCount(), 1)
})

test('should not clear current group concurrently', async (t) => {
  const runner = new GroupRunner(2)

  const tasks: Task<void>[] = []
  for (let i = 0; i < 4; i++) {
    tasks.push(createTask())
    runner.run(tasks[i].callback)
  }
  // Tasks 3 and 4 will both be waiting for tasks 1 and 2 to finish.
  // When they do, they should not both clear the current group resulting in a
  // group with only task 4.
  tasks[0].resolve(undefined)
  tasks[1].resolve(undefined)

  // If we did end up with a group of 1 after concurrent clearing, then task 5
  // will run immediately, which it shouldn't because task 3 and 4 are not
  // finished yet.
  const task5: Task<void> = createTask()
  runner.run(task5.callback)

  await sleep(0)
  t.is(task5.getCallCount(), 0)
})

test('multiple groups', async (t) => {
  const runner = new GroupRunner(3)

  const tasks: Task<void>[] = []
  for (let i = 0; i < 5; i++) {
    tasks.push(createTask(i))
    runner.run(tasks[i].callback)
  }

  await sleep(0)
  t.is(tasks[0].getCallCount(), 1)
  t.is(tasks[1].getCallCount(), 1)
  t.is(tasks[2].getCallCount(), 1)
  t.is(tasks[3].getCallCount(), 0)
  t.is(tasks[4].getCallCount(), 0)

  tasks[0].resolve(undefined)
  tasks[1].resolve(undefined)
  tasks[2].resolve(undefined)

  await sleep(0)
  t.is(tasks[3].getCallCount(), 1)
  t.is(tasks[4].getCallCount(), 1)

  // 5 more tasks for a total of 10:
  for (let i = 5; i < 10; i++) {
    tasks.push(createTask(i))
    runner.run(tasks[i].callback)
  }

  await sleep(0)
  t.is(tasks[5].getCallCount(), 1)
  t.is(tasks[6].getCallCount(), 0)
  t.is(tasks[7].getCallCount(), 0)
  t.is(tasks[8].getCallCount(), 0)
  t.is(tasks[9].getCallCount(), 0)

  tasks[3].resolve(undefined)
  tasks[4].resolve(undefined)
  tasks[5].resolve(undefined)

  await sleep(0)
  t.is(tasks[6].getCallCount(), 1)
  t.is(tasks[7].getCallCount(), 1)
  t.is(tasks[8].getCallCount(), 1)
  t.is(tasks[9].getCallCount(), 0)

  tasks[6].resolve(undefined)
  tasks[7].resolve(undefined)
  tasks[8].resolve(undefined)

  await sleep(0)
  t.is(tasks[9].getCallCount(), 1)
})

test('multiple return values', async (t) => {
  const runner = new GroupRunner(3)

  const tasks: Task<number>[] = []
  const promises: Promise<number>[] = []
  for (let i = 0; i < 10; i++) {
    tasks.push(createTask(i))
    promises.push(runner.run(tasks[i].callback))
  }

  await sleep(0)
  for (let i = 0; i < 10; i++) {
    tasks[i].resolve(i)
  }

  await sleep(0)
  for (let i = 0; i < 10; i++) {
    t.is(await promises[i], i)
  }
})

test('rejecting promises', async (t) => {
  const runner = new GroupRunner(2)

  const tasks: Task<void>[] = []
  for (let i = 0; i < 3; i++) {
    tasks.push(createTask())
  }

  runner.run(tasks[0].callback).catch(() => {
    /* ignore */
  })
  runner.run(tasks[1].callback).catch(() => {
    /* ignore */
  })
  runner.run(tasks[2].callback)

  await sleep(0)
  t.is(tasks[2].getCallCount(), 0)

  tasks[0].reject(undefined)

  await sleep(0)
  t.is(tasks[2].getCallCount(), 0)

  await sleep(0)
  tasks[1].reject(undefined)

  await sleep(0)
  t.is(tasks[2].getCallCount(), 1)
})

test('wrap function', async (t) => {
  const runner = new GroupRunner(2)

  const tasks: Task<number>[] = []
  for (let i = 0; i < 3; i++) {
    tasks.push(createTask())
  }

  const f = runner.wrapFunction((i: number) => tasks[i].callback())

  const promise0 = f(0)
  const promise1 = f(1)
  const promise2 = f(2)

  await sleep(0)
  t.is(tasks[2].getCallCount(), 0)

  tasks[0].resolve(0)

  await sleep(0)
  t.is(tasks[2].getCallCount(), 0)

  await sleep(0)
  tasks[1].resolve(1)

  await sleep(0)
  t.is(tasks[2].getCallCount(), 1)

  tasks[2].resolve(2)

  t.is(await promise0, 0)
  t.is(await promise1, 1)
  t.is(await promise2, 2)
})
