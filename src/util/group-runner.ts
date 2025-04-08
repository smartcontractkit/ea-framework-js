type Callback<T> = () => Promise<T>
type Resolve<T> = (arg: T | Promise<T>) => void

// Runs tasks in groups of a fixed size.
// The next group won't be started until the previous group is finished.
//
// Example usage:
//
// const fetchBalances(addresses: string[]): Promise<number[]> {
//    // addresses can contains thousands of addresses
//    const groupRunner = new GroupRunner<number[]>(10)
//    const getBalance = groupRunner.wrapFunction(fetchBalance)
//    const balancePromises: Promise<number>[] = []
//    for (const address of addresses) {
//      // There will be at most 10 concurrent calls to fetchBalance.
//      // fetchBalance might do an RPC and we don't want to get rate limited.
//      balancePromises.push(getBalance(address)))
//    }
//    return Promise.all(balancePromises)
// }
//
//
// Implementation note:
// Once the size has been reached, we wait for all previous tasks to finish
// before running the new task.
// Alternatively, we could run more tasks as soon as some (rather than all)
// tasks have finished, to make progress sooner, but the former is what's
// currently used in multiple places in the external-adapters-js repo so we
// chose that behavior.
export class GroupRunner {
  private currentGroup: Promise<unknown>[] = []
  private previousStartRunning: Promise<void> = Promise.resolve()

  constructor(private groupSize: number) {}

  // Calls the given callback eventually but makes sure any previous group of
  // groupSize size has settled before calling and subsequent callbacks.
  run<T>(callback: Callback<T>): Promise<T> {
    return new Promise(async (resolve) => {
      // This creates an implicit queue which guarantees that there are no
      // concurrent calls into startRunning. This is necessary to avoid having
      // currentGroup being cleared concurrently.
      this.previousStartRunning = this.previousStartRunning.then(() => {
        return this.startRunning(callback, resolve)
      })
    })
  }

  // Waits for a previous group to finish, if necessary, and then runs the
  // given callback. When this method resolves, the callback has been called
  // but not necessarily resolved.
  async startRunning<T>(callback: Callback<T>, resolve: Resolve<T>) {
    if (this.currentGroup.length >= this.groupSize) {
      await Promise.allSettled(this.currentGroup)
      this.currentGroup = []
    }
    const promise = callback()
    this.currentGroup.push(promise)
    resolve(promise)
  }

  wrapFunction<Args extends any[], Return>(
    func: (...args: Args) => Promise<Return>,
  ): (...args: Args) => Promise<Return> {
    return (...args: Args) => {
      return this.run(() => func(...args))
    }
  }
}
