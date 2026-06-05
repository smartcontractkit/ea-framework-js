// TurnQueue is used by Requester to make sure requests execute in turn and to
// limit the number of pending requests.
//
// Before a request is made the requester waits for the rate limiter inside a
// call to run() on the TurnQueue. This callback is only run when the previous
// request finished waiting for its rate limit.
//
// If the maximum number of pending turns is exceeded, the oldest pending turn
// is dropped and its callback is never run. Instead the call to run() throws
// an EvictedError.

export type Turn = {
  release: () => void
}

export class EvictedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EvictedError'
  }
}

class TurnNode {
  isDone = false
  _next: TurnNode | undefined = undefined
  starting: Promise<Turn | undefined>
  resolveStarting!: (turn: Turn | undefined) => void

  constructor(private queue: TurnQueue) {
    this.starting = new Promise((resolve) => {
      this.resolveStarting = resolve
    })
  }

  start() {
    this.resolveStarting({
      release: () => this.end(),
    })
  }

  drop() {
    this.resolveStarting(undefined)
  }

  get next(): TurnNode | undefined {
    return this._next
  }

  set next(value: TurnNode | undefined) {
    this._next = value
    this.maybeStartNext()
  }

  private end() {
    if (this.isDone) {
      throw new Error('Turn already ended')
    }
    this.isDone = true
    this.maybeStartNext()
  }

  private maybeStartNext() {
    if (this.isDone && this.next) {
      this.queue.startNext()
    }
  }
}

export class TurnQueue {
  length = 0
  active: TurnNode
  last: TurnNode

  constructor(private maxLength: number) {
    const ready = new TurnNode(this)
    ready.isDone = true
    this.active = ready
    this.last = ready
  }

  async runInTurn(task: () => Promise<void>): Promise<void> {
    const turn = await this.takeTurn()
    if (!turn) {
      throw new EvictedError('Too many pending turns')
    }

    try {
      await task()
    } finally {
      turn.release()
    }
  }

  private async takeTurn(): Promise<Turn | undefined> {
    const turn = new TurnNode(this)
    this.last.next = turn
    this.last = turn
    this.length++

    if (this.length > this.maxLength) {
      this.length--

      const first = this.active.next!
      if (first === this.last) {
        this.last = this.active
      }
      first.drop()
      this.active.next = first.next
    }

    return turn.starting
  }

  startNext() {
    this.length--
    this.active = this.active.next!
    this.active.start()
  }
}
