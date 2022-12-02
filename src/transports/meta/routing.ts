import { EndpointContext } from '../../adapter'
import { ResponseCache } from '../../cache/response'
import { AdapterConfig } from '../../config'
import { AdapterRequest, AdapterResponse, makeLogger } from '../../util'
import { AdapterError } from '../../validation/error'
import { MetaTransport, Transport, TransportDependencies, TransportGenerics } from '..'

const logger = makeLogger('RoutingTransport')

/**
 * Transport implementation that takes 2 or more transports and a function that determines with transport to use.
 *
 * @typeParam T - Helper struct type that will be used to pass types to the generic parameters (check [[TransportGenerics]])
 */
export class RoutingTransport<T extends TransportGenerics>
  // This complex class header is used to accommodate all different ways that underlying transports implement the Transport interface
  implements MetaTransport<T>
{
  constructor(
    //  This is public for tests, which sometimes need the underlying transport for things like ticking the clock
    public transports: { [key: string]: Transport<T> },
    // Route should return to a string key that corresponds to a transport in the transports object
    private route: (
      req: AdapterRequest<T['Request']>,
      adapterConfig?: AdapterConfig<T['CustomSettings']>,
    ) => string,
  ) {}
  responseCache!: ResponseCache<{
    Request: T['Request']
    Response: T['Response']
  }>
  backgroundExecute?: ((context: EndpointContext<T>) => Promise<void>) | undefined

  async initialize(
    dependencies: TransportDependencies<T>,
    adapterConfig: AdapterConfig<T['CustomSettings']>,
    endpointName: string,
  ): Promise<void> {
    logger.debug(`Initializing ${Object.keys(this.transports).length} transports`)
    await Promise.all(
      Object.entries(this.transports).map(([name, transport]) => {
        logger.debug(`Initializing transport ${name} (${transport.constructor.name})`)
        return transport.initialize(dependencies, adapterConfig, endpointName)
      }),
    )
  }

  async registerRequest(
    req: AdapterRequest<T['Request']>,
    adapterConfig: AdapterConfig<T['CustomSettings']>,
  ): Promise<void> {
    logger.debug(`registering request using `, req.requestContext.data)

    const transport = this.resolveTransport(req, adapterConfig)
    if (transport.registerRequest) {
      logger.debug(`Running registerRequest on retrieved transport`)
      return transport.registerRequest(req, adapterConfig)
    }
    logger.debug(`Retrieved transport doesn't implement registerRequest`)
  }

  private resolveTransport(
    req: AdapterRequest<T['Request']>,
    adapterConfig?: AdapterConfig<T['CustomSettings']>,
  ): Transport<T> {
    logger.debug(`routing request using `, req.requestContext.data)
    const key = this.route(req, adapterConfig || undefined)
    if (!this.transports[key]) {
      logger.error(`No transport found for key ${key}`)
      throw new AdapterError({ statusCode: 400, message: `No transport found for ${key}` })
    }
    const transport = this.transports[key]
    logger.debug(`Found ${transport.constructor.name} corresponding to ${key}`)
    return transport
  }

  // Allow AdapterResponse<any> below since we don't know what the adapter will return
  /* eslint-disable  @typescript-eslint/no-explicit-any */
  async foregroundExecute(
    req: AdapterRequest<T['Request']>,
    adapterConfig: AdapterConfig<T['CustomSettings']>,
  ): Promise<AdapterResponse<any> | void> {
    const transport = this.resolveTransport(req, adapterConfig)
    if (transport.foregroundExecute) {
      logger.debug(`Running foregroundExecute on retrieved transport`)
      return transport.foregroundExecute(req, adapterConfig)
    }
    logger.debug(`Retrieved transport doesn't implement foregroundExecute`)
  }
}
