import { InstalledClock } from '@sinonjs/fake-timers'
import { ExecutionContext } from 'ava'
import { LocalCache } from '../src/cache'
import { ResponseCache } from '../src/cache/response'
import { AdapterConfig, SettingsMap } from '../src/config'
import { Transport, TransportDependencies } from '../src/transports'
import { AdapterRequest, AdapterResponse, EmptyObject, PartialAdapterResponse } from '../src/util'
import { ReplyError } from 'ioredis'

export type NopTransportTypes = {
  Request: {
    Params: EmptyObject
  }
  Response: {
    Data: null
    Result: null
  }
  CustomSettings: SettingsMap
}

export class NopTransport implements Transport<NopTransportTypes> {
  responseCache!: ResponseCache<{
    Request: NopTransportTypes['Request']
    Response: NopTransportTypes['Response']
  }>

  async initialize(
    dependencies: TransportDependencies<NopTransportTypes>,
    config: AdapterConfig<NopTransportTypes['CustomSettings']>,
    endpointName: string,
  ): Promise<void> {
    this.responseCache = dependencies.responseCache
    return
  }

  async foregroundExecute(
    req: AdapterRequest<NopTransportTypes['Request']>,
  ): Promise<void | AdapterResponse<NopTransportTypes['Response']>> {
    return
  }
}

type Resolve<T> = (value: T) => void
export const deferredPromise = <T>(): [Promise<T>, Resolve<T>] => {
  let resolve!: Resolve<T>
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return [promise, resolve]
}

export class MockCache extends LocalCache {

  constructor(maxItems: number) {
    super(maxItems)
  }
  private awaitingPromiseResolve?: (value: unknown) => void

  waitForNextSet() {
    // eslint-disable-next-line no-promise-executor-return
    return new Promise((resolve) => (this.awaitingPromiseResolve = resolve))
  }

  override async set(key: string, value: unknown, ttl: number): Promise<void> {
    super.set(key, value, ttl)
    if (this.awaitingPromiseResolve) {
      this.awaitingPromiseResolve(value)
    }
  }
}

export async function runPeriodicAsyncBackgroundExecution(
  clock: InstalledClock,
  {
    interval,
    times,
    stepValidation,
  }: {
    interval: number
    times: number
    stepValidation: (iteration: number) => boolean
  },
) {
  for (let i = 0; i < times; i++) {
    // Tick once for the interval
    await clock.tickAsync(interval)

    // Then use auxiliary method to ensure that the background process, if it
    // spawns new timers, gets executed to completion
    await runAllUntil(clock, () => stepValidation(i))
  }
}

async function runAllUntil(clock: InstalledClock, isComplete: () => boolean): Promise<void> {
  while (!isComplete()) {
    await clock.nextAsync()
  }
}

export async function runAllUntilTime(clock: InstalledClock, time: number): Promise<void> {
  const targetTime = clock.now + time
  while (clock.now < targetTime) {
    await clock.nextAsync()
  }
}

export class RedisMock {
  store = new LocalCache<string>(100)

  get(key: string) {
    return this.store.get(key)
  }

  del(key: string) {
    return this.store.delete(key)
  }

  set(key: string, value: string, px: 'PX', ttl: number) {
    if (key.includes('force-error')) {
      throw { message: 'anything' } as typeof ReplyError
    }
    return this.store.set(key, value, ttl)
  }

  multi() {
    return new CommandChainMock(this)
  }
}

class CommandChainMock {
  promises: Promise<unknown>[] = []

  constructor(private redisMock: RedisMock) {}

  set(key: string, value: string, px: 'PX', ttl: number) {
    this.promises.push(this.redisMock.set(key, value, px, ttl))
    return this
  }

  exec() {
    return Promise.all(this.promises)
  }
}

export function assertEqualResponses(
  t: ExecutionContext,
  actual: AdapterResponse,
  expected: PartialAdapterResponse & {
    statusCode: number
  },
) {
  t.is(typeof actual?.timestamps?.providerDataReceived, 'number')
  t.is(
    typeof (
      actual?.timestamps?.providerDataReceived ?? actual?.timestamps?.providerDataStreamEstablished
    ),
    'number',
  )

  delete (actual as unknown as Record<string, unknown>)['timestamps']

  t.deepEqual(expected, actual)
}
