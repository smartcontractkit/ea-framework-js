import type EventSource from 'eventsource'
import Redis from 'ioredis'
import { Cache } from '../cache'
import { AdapterConfig, BaseAdapterConfig, SettingsMap } from '../config'
import {
  AdapterRateLimitTier,
  BackgroundExecuteRateLimiter,
  RequestRateLimiter,
} from '../rate-limiting'
import { Transport, TransportGenerics } from '../transports'
import { AdapterRequest, RequestGenerics, SubscriptionSetFactory } from '../util'
import { InputParameters } from '../validation'
import { AdapterError } from '../validation/error'
import { Adapter } from './basic'
import { AdapterEndpoint } from './endpoint'

export type CustomAdapterSettings = SettingsMap & NegatedAdapterSettings
type NegatedAdapterSettings = {
  [K in keyof BaseAdapterConfig]?: never
}

/**
 * Dependencies that will be injected into the Adapter on startup
 */
export interface AdapterDependencies {
  /** Specific instance of the Cache the adapter will use (e.g. Local, Redis, etc.) */
  cache: Cache

  /** Shared instance of the request rate limiter */
  requestRateLimiter: RequestRateLimiter

  /** Shared instance of the background execute rate limiter */
  backgroundExecuteRateLimiter: BackgroundExecuteRateLimiter

  /** Factory to create subscription sets based on the specified cache type */
  subscriptionSetFactory: SubscriptionSetFactory

  /** Redis client used for cache and subscription set */
  redisClient: Redis

  /** EventSource to use for listening to server sent events.  A mock EventSource can be provided as a dependency for testing */
  eventSource: typeof EventSource
}

/**
 * Context that will be used on background executions of a Transport.
 * For example, the endpointName used to log statements or generate Cache keys.
 */
export interface EndpointContext<T extends EndpointGenerics> {
  /** Endpoint name */
  endpointName: string

  /** Input parameters for this endpoint */
  inputParameters: InputParameters

  /** Initialized config for the adapter that the Transport can access */
  adapterConfig: AdapterConfig<T['CustomSettings']>
}

/**
 * Structure to describe rate limits specs for the Adapter
 */
export interface AdapterRateLimitingConfig {
  /** Adapter rate limits, gotten from the specific tier requested */
  tiers: Record<string, AdapterRateLimitTier>
}

/**
 * Type to perform arbitrary modifications on an adapter request
 */
export type RequestTransform<T extends RequestGenerics = RequestGenerics> = (
  req: AdapterRequest<T>,
) => void

/**
 * Map of overrides objects (symbol -\> symbol) per adapter name
 */
export type Overrides = {
  [adapterName: string]: {
    [symbol: string]: string
  }
}

/**
 * Main structure of an External Adapter
 */
export interface AdapterParams<CustomSettings extends SettingsMap> {
  /** Name of the adapter */
  name: Uppercase<string>

  /** If present, the string that will be used for requests with no specified endpoint */
  defaultEndpoint?: string

  /**
   * List of [[AdapterEndpoint]]s in the adapter. This is purposefully typed any; it's the correct type in this case.
   *
   * When you try to create an adapter and you provide an endpoint, if these generics were set to "unknown" instead
   * what would happen is that Typescript would check if the types match, and would fail to assign unknown to the
   * specific Params or Result in the transport itself.
   * We also can't use generics, because if we had more than one transport with different requests (very likely)
   * then those new types wouldn't match with each other.
   */
  endpoints: AdapterEndpoint<any>[] // eslint-disable-line @typescript-eslint/no-explicit-any

  /** Map of overrides to the default config values for an Adapter */
  envDefaultOverrides?: Partial<BaseAdapterConfig>

  /** List of custom env vars for this particular adapter (e.g. RPC_URL) */
  customSettings?: SettingsMap

  /** Configuration relevant to outbound (EA --\> DP) communication rate limiting */
  rateLimiting?: AdapterRateLimitingConfig

  /** Overrides for converting the 'base' parameter that are hardcoded into the adapter. */
  // This must be included in the middleware in order to generate deterministing cache keys for hardcoded overrides
  overrides?: Record<string, string>

  /** Transforms that will apply to the request before submitting it through the adapter request flow */
  requestTransforms?: RequestTransform[]

  /** Bootstrap function that will run when initializing the adapter */
  bootstrap?: (adapter: Adapter<CustomSettings>) => Promise<void>
}

/**
 * Structure to describe rate limits specs for a specific adapter endpoint
 */
export interface EndpointRateLimitingConfig {
  /**
   * How much of the total limit for the adapter will be assigned to this specific endpoint.
   * Should be a non-zero positive number up to 100.
   * Endpoints in the same adapter without a specific allocation will divide the remaining limits equally.
   */
  allocationPercentage: number
}

/**
 * Helper type structure that contains the different types passed to the generic parameters of an AdapterEndpoint
 */
export type EndpointGenerics = TransportGenerics

export type CustomInputValidator<T extends EndpointGenerics> = (
  input: T['Request']['Params'],
  config: AdapterConfig<T['CustomSettings']>,
) => AdapterError | undefined

/**
 * Structure to describe a specific endpoint in an [[Adapter]]
 */
export interface AdapterEndpointParams<T extends EndpointGenerics> {
  /** Name that will be used to match input params to this endpoint (case insensitive) */
  name: string

  /** List of alternative endpoint names that will resolve to this same transport (case insensitive) */
  aliases?: string[]

  /** Transport that will be used to handle data processing and communication for this endpoint */
  transport: Transport<T>

  /** Specification of what the body of a request hitting this endpoint should look like (used for validation) */
  inputParameters: InputParameters

  /** Specific details related to the rate limiting for this endpoint in particular */
  rateLimiting?: EndpointRateLimitingConfig

  /** Custom function that generates cache keys */
  cacheKeyGenerator?: (data: Record<string, unknown>) => string

  /** Custom input validation. Void function that should throw AdapterInputError on validation errors */
  customInputValidation?: CustomInputValidator<T>
}
