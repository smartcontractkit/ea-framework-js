import { AdapterDependencies, EndpointContext } from '../adapter'
import { ResponseCache } from '../cache/response'
import { AdapterConfig, SettingsMap } from '../config'
import { AdapterRequest, AdapterResponse, RequestGenerics, ResponseGenerics } from '../util/types'

export * from './http'
export * from './sse'
export * from './websocket'

/**
 * Helper struct type that will be used to pass types to the generic parameters of a Transport.
 * Within the transport, given a generic param T extends TransportGenerics, these will be used like so:
 *
 * const request: AdapterRequest\<T['Request']\> = ...
 *
 * (ignore the slash characters, they're just for proper doc syntax \<)
 */
export type TransportGenerics = {
  /**
   * Type details about incoming Adapter requests to this Transport
   */
  Request: RequestGenerics

  /**
   * Type details about outbound responses from this Transport
   */
  Response: ResponseGenerics

  /**
   * Type for any custom settings used for this Transport
   */
  CustomSettings: SettingsMap
}

/**
 * Extended dependencies with necessary tools for a transport
 */
export type TransportDependencies<T extends TransportGenerics> = AdapterDependencies & {
  /**
   * Cache that will be used to write responses that the Transport will return
   */
  responseCache: ResponseCache<{
    Request: T['Request']
    Response: T['Response']
  }>
}

/**
 * Generic interface for a Transport.
 * A Transport defines the way in which an AdapterEndpoint will process incoming requests to
 * fetch data from a Data Provider. The setup phase will take care of the former, while the
 * backgroundExecute will be in charge of the latter.
 * This separation gives us the ability of splitting these concerns, and optionally parallelizing
 * the reading and writing of data to a centralized Cache.
 *
 * @typeParam T - Helper struct type that will be used to pass types to the generic parameters (check [[TransportGenerics]])
 */
export interface Transport<T extends TransportGenerics> {
  responseCache: ResponseCache<{
    Request: T['Request']
    Response: T['Response']
  }>

  /**
   * Initializes the transport in the Adapter context.
   *
   * @param dependencies - Adapter dependencies (e.g. cache instance)
   * @param config - Adapter config containing env vars
   * @returns an empty Promise
   */
  initialize: (
    dependencies: TransportDependencies<T>,
    config: AdapterConfig<T['CustomSettings']>,
    endpointName: string,
  ) => Promise<void>

  /**
   * Registers a request within the context of the transport.
   * This means things like adding the request to a subscription set.
   *
   * @param req - the incoming AdapterRequest
   * @param config - common configuration for the Adapter as a whole
   * @returns an empty Promise
   */
  registerRequest?: (
    req: AdapterRequest<T['Request']>,
    config: AdapterConfig<T['CustomSettings']>,
  ) => Promise<void>

  /**
   * Performs a synchronous fetch/processing of information within the lifecycle of an incoming request.
   * This is mostly intended to be used as a backwards compatibility mechanism, or for very specific cases where
   * processing is expected to be very simple. Things like rate limiting for example won't be able to be applied
   * to this method with more than one EA instance. It's heavily encouraged to instead rework adapter logic
   * to perform as much of the work as possible (or all of it) in the backgroundExecute method.
   *
   * @param req - the incoming AdapterRequest
   * @param config - common configuration for the Adapter as a whole
   * @returns a Promise that _optionally_ returns an AdapterResponse, if the Transport has the capability of
   *   immediately fetching data and returning it without the background process.
   */
  foregroundExecute?: (
    req: AdapterRequest<T['Request']>,
    config: AdapterConfig<T['CustomSettings']>,
  ) => Promise<AdapterResponse<{
    Data: T['Response']['Data']
    Result: T['Response']['Result']
  }> | void>

  /**
   * Main function that will be called by the main background loop of the writer EA.
   * All logic fetching from providers should live here.
   *
   * @param context - background context for the execution (e.g. endpoint name)
   * @returns an empty Promise
   */
  backgroundExecute?: (context: EndpointContext<T>) => Promise<void>
}

/**
 * Generic interface for a Transport that contains or manages other transports.
 * Some transports, such as the RoutingTransport, do not directly fetch data from a Data Provider, but
 * instead coordinate the execution of other transports for fetching and transforming data.
 * These transports have alternative initialization procedures, which typically involve
 * initializing each downstream transport.
 *
 * @typeParam Params - the structure of the AdapterRequest's body
 * @typeParam Result - the structure of the AdapterResponse's body
 * @typeParam CustomSettings - custom settings for the Adapter, or the default SettingsMap
 */

export interface MetaTransport<T extends TransportGenerics> extends Transport<T> {
  transports: { [key: string]: Transport<T> }
}
