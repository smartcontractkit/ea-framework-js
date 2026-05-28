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

    const compareCache = new CompareResponseCache(
      transportName,
      this.responseCache,
      (next, current) =>
        (next.timestamps?.providerIndicatedTimeUnixMs ?? 0) >
        (current?.timestamps?.providerIndicatedTimeUnixMs ?? 0),
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
    const results = await Promise.allSettled(
      Object.values(this.transports).map((t) => t.registerRequest?.(req, adapterSettings)),
    )
    results
      .filter((r) => r.status === 'rejected')
      .forEach((r) => {
        logger.error(`Transport registerRequest failed: ${r.reason}`)
      })
  }

  async backgroundExecute(context: EndpointContext<T>): Promise<void> {
    const results = await Promise.allSettled(
      Object.values(this.transports).map((t) => t.backgroundExecute?.(context)),
    )

    results
      .filter((r) => r.status === 'rejected')
      .forEach((r) => {
        logger.error(`Transport backgroundExecute failed: ${r.reason}`)
      })
  }
}
