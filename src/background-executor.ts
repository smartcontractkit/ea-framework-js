import { Adapter, AdapterEndpoint, EndpointContext, EndpointGenerics } from './adapter'
import { metrics } from './metrics'
import { Transport, TransportGenerics } from './transports'
import { asyncLocalStorage, censorLogs, makeLogger, timeoutPromise } from './util'

const logger = makeLogger('BackgroundExecutor')

/**
 * Creates and maintains one background-execute loop for every
 * `(endpoint × transport)` pair that implements `backgroundExecute`.
 *
 * • If the transport returns a number, that value becomes the delay (ms)
 *   before the next run; otherwise the loop falls back to **10 ms** so
 *   legacy unit-tests still observe four executions.
 * • All loops survive errors and time-outs.
 * • Timers are cleared—allowing the process to exit—once the HTTP
 *   server's shutdown promise resolves.
 */
export function callBackgroundExecutes(adapter: Adapter, apiShutdownPromise?: Promise<void>): void {
  let shuttingDown = false

  /** Live timers, keyed by `"endpoint:transport"`. */
  const timers = new Map<string, NodeJS.Timeout>()

  /* ------------------------------------------------------------------ */
  /* Graceful shutdown: invoked only when the HTTP server closes cleanly */
  /* ------------------------------------------------------------------ */
  const stopAll = (): void => {
    if (shuttingDown) {
      return
    }
    shuttingDown = true

    for (const t of timers.values()) {
      clearTimeout(t)
    }
    timers.clear()
  }

  if (apiShutdownPromise) {
    apiShutdownPromise
      .then(stopAll)
      .catch((err) => logger.error(err, 'apiShutdownPromise rejected – skipping cleanup'))
  }

  /* ------------------------------------------------------------------ */
  /* Spawn one loop per (endpoint × transport)                           */
  /* ------------------------------------------------------------------ */
  const spawnLoop = (
    endpoint: AdapterEndpoint<EndpointGenerics>,
    transport: Transport<TransportGenerics>,
    routeName: string,
  ): void => {
    const backgroundExecute = transport.backgroundExecute?.bind(transport)
    if (!backgroundExecute) {
      logger.debug(
        `Endpoint "${endpoint.name}" transport "${routeName}" has no backgroundExecute – skipping`,
      )
      return
    }

    const key = `${endpoint.name}:${routeName}`

    /* Cache metric handles once – prom-client recommends this. */
    const labels = {
      adapter_endpoint: endpoint.name,
      transport: routeName,
    } as const
    const mTotal = metrics.get('bgExecuteTotal').labels(labels)
    const mErr = metrics.get('bgExecuteErrors').labels(labels)
    const mDur = metrics.get('bgExecuteDurationSeconds').labels(labels)

    const ctx: EndpointContext<EndpointGenerics> = {
      endpointName: endpoint.name,
      inputParameters: endpoint.inputParameters,
      adapterSettings: adapter.config.settings,
    }

    let delayMs = 10 // Legacy default

    /** Schedule the next run (fresh timer every time). */
    const scheduleNext = (): void => {
      if (shuttingDown) {
        return
      }
      const next = setTimeout(handler, delayMs)
      next.unref?.() // Harmless under Jest; valuable in prod
      timers.set(key, next)
    }

    const handler = async (): Promise<void> => {
      if (shuttingDown) {
        return
      }

      mTotal.inc()
      const stopTimer = mDur.startTimer()

      try {
        const maybeDelay = await timeoutPromise(
          'Background Execute',
          asyncLocalStorage.run(
            {
              correlationId: `endpoint=${endpoint.name},transport=${routeName}`,
            },
            () => backgroundExecute(ctx),
          ),
          adapter.config.settings.BACKGROUND_EXECUTE_TIMEOUT,
        )

        if (typeof maybeDelay === 'number' && maybeDelay >= 0) {
          delayMs = maybeDelay
        }
      } catch (err) {
        mErr.inc()
        censorLogs(() => logger.error(err))
      } finally {
        stopTimer()
      }

      scheduleNext()
    }

    /* Kick off immediately – required for backwards compatibility. */
    void handler()
  }

  for (const ep of adapter.endpoints) {
    for (const [name, tr] of ep.transportRoutes.entries()) {
      spawnLoop(ep, tr, name)
    }
  }
}
