import test from 'ava'
import { deferredPromise, sleep } from '../../src/util'
import { EvictedError, TurnQueue } from '../../src/util/turn-queue'

// Flush pending microtasks so the queue's transitions settle before asserting.
const flush = () => sleep(0)

type Run = {
  started: boolean
  finished: boolean
  evicted: boolean
  error: unknown
  finish: () => void
  promise: Promise<void>
}

// Starts a queue.runInTurn() whose task blocks until finish() is called, so a
// test can hold a turn and observe whether the caller is running, finished, or
// evicted.
const startRun = (queue: TurnQueue): Run => {
  const [blockUntilFinished, unblock] = deferredPromise<void>()
  const run: Run = {
    started: false,
    finished: false,
    evicted: false,
    error: undefined,
    finish: () => unblock(undefined),
    promise: Promise.resolve(),
  }
  run.promise = queue
    .runInTurn(async () => {
      run.started = true
      await blockUntilFinished
    })
    .then(() => {
      run.finished = true
    })
    .catch((error) => {
      run.error = error
      run.evicted = error instanceof EvictedError
    })
  return run
}

test('runs the task immediately when the queue is free', async (t) => {
  const queue = new TurnQueue(1)

  const a = startRun(queue)
  await flush()
  t.true(a.started)
  t.false(a.finished)

  a.finish()
  await flush()
  t.true(a.finished)
})

test('runs tasks one at a time', async (t) => {
  const queue = new TurnQueue(5)

  const a = startRun(queue)
  const b = startRun(queue)
  await flush()

  t.true(a.started)
  t.false(b.started) // Only one task runs at a time

  a.finish()
  await flush()
  t.true(a.finished)
  t.true(b.started)
  t.false(b.finished)

  b.finish()
  await flush()
  t.true(b.finished)
})

test('runs waiting tasks in FIFO order', async (t) => {
  const queue = new TurnQueue(5)

  const runs = [startRun(queue), startRun(queue), startRun(queue)]
  await flush()

  t.true(runs[0].started)
  t.false(runs[1].started)
  t.false(runs[2].started)

  runs[0].finish()
  await flush()
  t.true(runs[1].started)
  t.false(runs[2].started)

  runs[1].finish()
  await flush()
  t.true(runs[2].started)

  runs[2].finish()
  await flush()
  t.true(runs[2].finished)
})

test('releases the turn even if the task throws', async (t) => {
  const queue = new TurnQueue(5)

  const failing = queue.runInTurn(async () => {
    throw new Error('boom')
  })
  const next = startRun(queue)

  // The error from the task propagates to the runInTurn() caller.
  await t.throwsAsync(failing, { message: 'boom' })
  await flush()

  // The next task still gets its turn because the failed one released.
  t.true(next.started)

  next.finish()
  await flush()
  t.true(next.finished)
})

test('maxLength 0: evicts a task requested while one is running', async (t) => {
  const queue = new TurnQueue(0)

  const a = startRun(queue)
  await flush()
  t.true(a.started)

  const b = startRun(queue)
  await flush()
  t.true(b.evicted)
  t.false(b.started)

  // After the running task finishes, a fresh task can run again.
  a.finish()
  await flush()

  const c = startRun(queue)
  await flush()
  t.true(c.started)

  c.finish()
  await flush()
})

test('maxLength 1: evicts the oldest waiter when a new one arrives', async (t) => {
  const queue = new TurnQueue(1)

  const a = startRun(queue) // Runs
  const b = startRun(queue) // Waits
  await flush()
  t.true(a.started)
  t.false(b.started)
  t.false(b.evicted)

  const c = startRun(queue) // Evicts b
  await flush()
  t.true(b.evicted)
  t.false(c.started) // C is now the only waiter

  a.finish()
  await flush()
  t.true(c.started) // C runs, skipping the evicted b

  c.finish()
  await flush()
})

test('maxLength 2: evicts the oldest waiter and keeps the newer ones', async (t) => {
  const queue = new TurnQueue(2)

  const a = startRun(queue) // Runs
  const b = startRun(queue) // Waits
  const c = startRun(queue) // Waits
  const d = startRun(queue) // Evicts b
  await flush()

  t.true(a.started)
  t.true(b.evicted)
  t.false(c.started)
  t.false(c.evicted)
  t.false(d.started)
  t.false(d.evicted)

  a.finish()
  await flush()
  t.true(c.started)
  t.false(d.started)

  c.finish()
  await flush()
  t.true(d.started)

  d.finish()
  await flush()
})

test('maxLength 1: repeated arrivals keep only the newest waiter', async (t) => {
  const queue = new TurnQueue(1)

  const a = startRun(queue)
  const b = startRun(queue)
  const c = startRun(queue) // Evicts b
  const d = startRun(queue) // Evicts c
  await flush()

  t.true(a.started)
  t.true(b.evicted)
  t.true(c.evicted)
  t.false(d.started)
  t.false(d.evicted)

  a.finish()
  await flush()
  t.true(d.started)

  d.finish()
  await flush()
})

test('throws EvictedError without running the task when evicted', async (t) => {
  const queue = new TurnQueue(0)

  const a = startRun(queue)
  await flush()

  const b = startRun(queue)
  await flush()

  t.true(b.error instanceof EvictedError)
  t.false(b.started) // The task of an evicted caller never runs

  a.finish()
  await flush()
})

test('tracks the number of waiting tasks in length', async (t) => {
  const queue = new TurnQueue(5)

  t.is(queue.length, 0)

  const a = startRun(queue)
  await flush()
  t.is(queue.length, 0) // The running task is not counted as waiting

  const b = startRun(queue)
  const c = startRun(queue)
  await flush()
  t.is(queue.length, 2)

  a.finish()
  await flush()
  t.is(queue.length, 1) // B runs, c still waits

  b.finish()
  await flush()
  t.is(queue.length, 0)

  c.finish()
  await flush()
})

test('reuses the queue after it drains', async (t) => {
  const queue = new TurnQueue(2)

  const a = startRun(queue)
  await flush()
  a.finish()
  await flush()
  t.true(a.finished)

  const b = startRun(queue)
  await flush()
  t.true(b.started)
  b.finish()
  await flush()
  t.true(b.finished)
})
