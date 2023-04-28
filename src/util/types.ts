import { FastifyReply, FastifyRequest, HookHandlerDoneFunction } from 'fastify'
import { Adapter } from '../adapter'
import { AdapterError } from '../validation/error'
import { InputParametersDefinition, TypeFromDefinition } from '../validation/input-params'
declare module 'fastify' {
  // eslint-disable-next-line no-shadow
  export interface FastifyRequest {
    requestContext: AdapterRequestContext<unknown>
  }
}

// Helper type: all of the types of T1 and T2, where T2 takes priority
export type Merge<T1, T2> = {
  [K in keyof T1 | keyof T2]: K extends keyof T2 ? T2[K] : K extends keyof T1 ? T1[K] : never
}

/**
 * Structure for the body of all requests that will be sent to the adapter
 */
export interface AdapterRequestBody<T = AdapterRequestData> {
  /** Adapter endpoint (not to be confused with REST API endpoint) */
  endpoint?: string

  /** Main data that will be validated and used on each adapter request */
  data: T
}

/**
 * Object that will be added to the request on a successful validation.
 * Contains all the necessary information the adapter will need across the request execution.
 */
export type AdapterRequestContext<T> = {
  /** Name of the endpoint this payload should be directed to */
  endpointName: string

  /** Name of the endpoint this payload should be directed to */
  transportName: string

  /** Precalculated cache key used to get and set corresponding values from the cache and subscription sets */
  cacheKey: string

  /** Normalized and validated data coming from the request body */
  data: T

  /** Metadata relevant to this particular request */
  meta?: AdapterRequestMeta
}

/**
 * Helper type to denote an empty body
 */
type EmptyBody = Record<string, never>

/**
 * Helper type to provide fastify for all adapter handlers
 */
export type AdapterRouteGeneric = {
  /** Set to an empty record so the user does not access the raw request data and uses the Validated data from the context instead */
  Body: EmptyBody
}

/**
 * Structure for all requests incoming to this adapter
 */
export type AdapterRequest<T> = FastifyRequest<AdapterRouteGeneric> & {
  /** Set to an empty record so the user does not access the raw request data and uses the Validated data from the context instead */
  body: EmptyBody

  /** Container for all validated information that will be used by the framework across this request's lifecycle */
  requestContext: AdapterRequestContext<T>
}

/**
 * Metadata for a particular request
 */
export interface AdapterRequestMeta {
  /** Relevant metrics gathered for this request */
  metrics?: AdapterMetricsMeta

  /** An error that ocurred somewhere along this requests' lifecycle */
  error?: AdapterError | Error
}

/**
 * Metadata for a particular response
 */
export interface AdapterResponseMeta extends AdapterRequestMeta {
  /** Name of the adapter */
  adapterName: string
}

/**
 * Meta info that pertains to exposing metrics
 */
export interface AdapterMetricsMeta {
  /** String to uniquely identify a specific price feed */
  feedId?: string

  /** Boolean to note if this request's response was found in the cache directly */
  cacheHit?: boolean
}

/**
 * Map of overrides objects (symbol -\> symbol) per adapter name
 */
export type Overrides = {
  [adapterName: string]: {
    [symbol: string]: string
  }
}

/**
 * Input params that can always be present in an incoming request
 */
type CommonAdapterRequestParams = {
  endpoint?: string
  transport?: string
  overrides?: Overrides
}
export type ReservedInputParameterNames = keyof CommonAdapterRequestParams

/**
 * Basic shape for the data within the request body
 */
export type AdapterRequestData = Record<string, unknown> & CommonAdapterRequestParams

export type ProviderResultGenerics = {
  Parameters: InputParametersDefinition
  Response: ResponseGenerics
}

/**
 * Helper type to hold the value from responses from a provider, and the adapter params they correspond to.
 */
export type ProviderResult<T extends ProviderResultGenerics> = {
  /** The set of parameters that uniquely relate to the response */
  params: TypeFromDefinition<T['Parameters']>

  /** Value that will be included in the result property of the response */
  response: PartialAdapterResponse<T['Response']>
}

export type TimestampedProviderResult<T extends ProviderResultGenerics> = Pick<
  ProviderResult<T>,
  'params'
> & {
  /** Value that will be included in the result property of the response, with timestamps applied */
  response: TimestampedAdapterResponse<T['Response']>
}

/**
 * Helper struct type that provides detail about the outgoing Adapter Response
 */
export type ResponseGenerics = {
  /**
   * Type for the data property of the response.
   */
  Data: unknown

  /**
   * Type for the result property of the response.
   * This is mostly used for OCR, and corresponds to one "word" when talking about it from an on-chain perspective.
   */
  Result: string | number | null
}

/**
 * Details for timestamps to be included in the response
 */
export type ResponseTimestamps = {
  /** Time at which data was received from the provider */
  providerDataReceivedUnixMs: number

  /** Time indicated by the provider representing the time at which this value was calculated/set/valid */
  providerIndicatedTimeUnixMs: number | undefined // This is | undefined and not optional (:?) to force every transport impl to explicitly include this
} & (
  | {
      /**
       * For sync protocols (request -\> response).
       * Time at which data was requested from the provider.
       */
      providerDataRequestedUnixMs: number
      providerDataStreamEstablishedUnixMs?: never // <- to make sure it's one or the other
    }
  | {
      /**
       * For async protocols (subscription -\> n events received).
       * Time at which a data stream was established for the provider.
       */
      providerDataStreamEstablishedUnixMs: number
      providerDataRequestedUnixMs?: never // <- to make sure it's one or the other
    }
)

/**
 * Object with timestamps that will be present in both successful and provider error responses
 */
type TimestampedResponseObject = {
  /** Timestamps relevant for data provider timings */
  timestamps: ResponseTimestamps
}

/**
 * Response from the EA to send when manually storing an error in the cache
 */
type ProviderErrorResponse = {
  /** Status code for the errored response */
  statusCode: number

  /** Error message that will be sent back from the adapter */
  errorMessage: string
} & {
  // Ensure the union types below (e.g. [[AdapterResponse]]) are mutually exclusive
  data?: never
  result?: never
  meta?: never
}

/**
 * Provider error response with timestamps added
 */
export type TimestampedProviderErrorResponse = ProviderErrorResponse & TimestampedResponseObject

/**
 * The most basic data that needs to be manually set for an adapter response.
 */
export type PartialSuccessfulResponse<T extends ResponseGenerics> = {
  /** Response data, holds "result" for Flux Monitor */
  data: T['Data']

  /** Result value used for OCR */
  result: T['Result']

  /** Optionally, specify manually some of the timestamps here */
  timestamps?: Pick<ResponseTimestamps, 'providerIndicatedTimeUnixMs'>
} & {
  // Ensure the union types below (e.g. [[AdapterResponse]]) are mutually exclusive
  errorMessage?: never
}

/**
 * Partial EA response, with timestamps added
 */
type TimestampedSuccessfulResponse<T extends ResponseGenerics> = PartialSuccessfulResponse<T> &
  TimestampedResponseObject

/**
 * Full EA successful response, with metadata and defaults added
 */
type SuccessfulResponse<T extends ResponseGenerics> = TimestampedSuccessfulResponse<T> & {
  /** Metadata relevant to this response */
  meta?: AdapterResponseMeta

  /** HTTP status code, by default will be set to 200 */
  statusCode: number
}

/**
 * Response body from the EA, before timestamps, defaults and metadata are filled in
 */
export type PartialAdapterResponse<T extends ResponseGenerics = ResponseGenerics> =
  | PartialSuccessfulResponse<T>
  | ProviderErrorResponse

/**
 * Response body from the EA with timestamps, before defaults and metadata are filled in
 */
export type TimestampedAdapterResponse<T extends ResponseGenerics = ResponseGenerics> =
  | TimestampedSuccessfulResponse<T>
  | TimestampedProviderErrorResponse

/**
 * Shape of the response body from the adapter
 */
export type AdapterResponse<T extends ResponseGenerics = ResponseGenerics> =
  | SuccessfulResponse<T>
  | TimestampedProviderErrorResponse

export type SingleNumberResultResponse = {
  Result: number
  Data: {
    result: number
  }
}

export type Middleware =
  | ((
      req: FastifyRequest,
      reply: FastifyReply,
      done: HookHandlerDoneFunction,
    ) => FastifyReply | void)
  | ((req: FastifyRequest, reply: FastifyReply) => Promise<FastifyReply | void>)

export type AdapterMiddlewareBuilder = (adapter: Adapter) => Middleware

export type Writeable<T> = {
  -readonly [K in keyof T]: T[K]
}
