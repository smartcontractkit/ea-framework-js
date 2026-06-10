import { EndpointContext } from '../adapter'
import { CompareResponseCache } from '../cache/response-cache/compare'
import { ResponseCache } from '../cache/response'
import { makeLogger } from '../util'
import { AdapterRequest } from '../util/types'
import { TypeFromDefinition } from '../validation/input-params'
import type { Transport, TransportDependencies, TransportGenerics } from '.'

const logger = makeLogger('CompositeTransport')

// Send requests to multiple transports and merge responses into a single cache according to bigger providerIndicatedTimeUnixMs
export class CompositeTransport<T extends TransportGenerics> implements Transport<T> {
  name!: string
  responseCache!: ResponseCache<T>

  constructor(private readonly transports: Record<string, Transport<T>>) {}

  async initialize(
    dependencies: TransportDependencies<T>,
    adapterSettings: T['Settings'],
    endpointName: string,
    transportName: string,
  ): Promise<void> {
    this.name = transportName
    this.responseCache = dependencies.responseCache

    const staleThreshold =
      adapterSettings.COMPOSITE_TRANSPORT_STALE_THRESHOLD_MS ?? adapterSettings.CACHE_MAX_AGE / 2

    const compareCache = new CompareResponseCache(
      transportName,
      this.responseCache,
      (next, current) => {
        // If newer timestamp, return true.
        // If same timestamp and value, return true to refresh TTL. This may be from another transport.
        // If same timestamp and different value but current entry is older than staleThreshold, return true to avoid serving stale data after a transport goes silent.
        // If same timestamp and different value and current entry is fresh, return false to avoid rubberbanding between transports.
        const newTimestamp = next.timestamps?.providerIndicatedTimeUnixMs ?? 0
        const currentTimestamp = current?.timestamps?.providerIndicatedTimeUnixMs ?? 0
        const newReceivedTimestamp = next.timestamps?.providerDataReceivedUnixMs ?? 0
        const currentReceivedTimestamp = current?.timestamps?.providerDataReceivedUnixMs ?? 0
        const newData = JSON.stringify(next.data)
        const currentData = JSON.stringify(current?.data)
        return (
          newTimestamp > currentTimestamp ||
          (newTimestamp === currentTimestamp && newData === currentData) ||
          (newTimestamp === currentTimestamp &&
            newReceivedTimestamp > currentReceivedTimestamp + staleThreshold)
        )
      },
    )

    await Promise.all(
      Object.entries(this.transports).map(([name, transport]) =>
        transport.initialize(
          { ...dependencies, responseCache: compareCache },
          adapterSettings,
          endpointName,
          name,
        ),
      ),
    )
  }

  async registerRequest(
    req: AdapterRequest<TypeFromDefinition<T['Parameters']>>,
    adapterSettings: T['Settings'],
  ): Promise<void> {
    const entries = Object.entries(this.transports)
    const results = await Promise.allSettled(
      entries.map(([, t]) => t.registerRequest?.(req, adapterSettings)),
    )
    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        logger.error(`Transport "${entries[i][0]}" registerRequest failed: ${r.reason}`)
      }
    })
  }

  async backgroundExecute(context: EndpointContext<T>): Promise<void> {
    const entries = Object.entries(this.transports)

    // Note that this will wait for the slowest transport to resolve before completing
    // this shared backgroundExecute loop and stalling the faster transport(s).
    // Consider setting lower timeouts on the individual transports if this becomes an issue.
    const results = await Promise.allSettled(entries.map(([, t]) => t.backgroundExecute?.(context)))

    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        logger.error(`Transport "${entries[i][0]}" backgroundExecute failed: ${r.reason}`)
      }
    })
  }
}
