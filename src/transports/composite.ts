import { EndpointContext } from '../adapter'
import { CompareResponseCache } from '../cache/response-cache/compare'
import { ResponseCache } from '../cache/response'
import { AdapterRequest, AdapterResponse } from '../util/types'
import { TypeFromDefinition } from '../validation/input-params'
import type { Transport, TransportDependencies, TransportGenerics } from '.'

export type CompositeTransportConfig<T extends TransportGenerics> = {
  transports: Record<string, Transport<T>>

  /**
   * @param next - the next response to be written to the cache
   * @param current - the current response in the cache
   * @returns true if next should replace current in cache
   */
  shouldUpdate: (
    next: AdapterResponse<T['Response']>,
    current?: AdapterResponse<T['Response']>,
  ) => boolean
}

// Send requests to multiple transports and merge responses into a single cache according to shouldUpdate
export class CompositeTransport<T extends TransportGenerics> implements Transport<T> {
  name!: string
  responseCache!: ResponseCache<T>
  private transports: Transport<T>[] = []

  constructor(private readonly config: CompositeTransportConfig<T>) {}

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
      this.config.shouldUpdate,
    )

    await Promise.all(
      Object.entries(this.config.transports).map(([name, transport]) =>
        transport.initialize(
          { ...dependencies, responseCache: compareCache },
          adapterSettings,
          endpointName,
          name,
        ),
      ),
    )

    this.transports = Object.values(this.config.transports)
  }

  async registerRequest(
    req: AdapterRequest<TypeFromDefinition<T['Parameters']>>,
    adapterSettings: T['Settings'],
  ): Promise<void> {
    await Promise.all(this.transports.map((t) => t.registerRequest?.(req, adapterSettings)))
  }

  async backgroundExecute(context: EndpointContext<T>): Promise<void> {
    await Promise.all(this.transports.map((t) => t.backgroundExecute?.(context)))
  }
}
