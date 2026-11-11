import { SimpleResponseCache } from '../cache/response'
import { AdapterSettings } from '../config'
import { TransportRoutes } from '../transports'
import { CompositeTransport } from '../transports/composite'
import {
  AdapterRequest,
  AdapterRequestData,
  AdapterResponse,
  Overrides,
  TimestampedAdapterResponse,
  TimestampedProviderResult,
  censor,
  censorLogs,
  makeLogger,
  getCanonicalAdapterName,
  canonicalizeAdapterNameKeys,
} from '../util'
import { metrics } from '../metrics'
import CensorList from '../util/censor/censor-list'
import {
  ensureProviderResult,
  hasInversionEnabled,
  INVERSION_PARAM,
  InversionPolicy,
} from './inverse'
import { tryClone } from '../util/clone'
import { InputParameters } from '../validation'
import { AdapterError } from '../validation/error'
import { TypeFromDefinition } from '../validation/input-params'
import {
  AdapterDependencies,
  AdapterEndpointInterface,
  AdapterEndpointParams,
  CustomInputValidator,
  CustomOutputValidator,
  EndpointGenerics,
  EndpointRateLimitingConfig,
  RequestTransform,
} from './types'

const logger = makeLogger('AdapterEndpoint')
export const DEFAULT_TRANSPORT_NAME = 'default_single_transport'

/**
 * Main class to represent an endpoint within an External Adapter
 */
export class AdapterEndpoint<T extends EndpointGenerics> implements AdapterEndpointInterface<T> {
  name: string
  adapterName!: string
  aliases?: string[] | undefined
  transportRoutes: TransportRoutes<T>
  inputParameters: InputParameters<T['Parameters']>
  rateLimiting?: EndpointRateLimitingConfig | undefined
  cacheKeyGenerator?: (data: TypeFromDefinition<T['Parameters']>) => string
  customInputValidation?: CustomInputValidator<T>
  customOutputValidation?: CustomOutputValidator | undefined
  inversionPolicy?: InversionPolicy<T>

  /**
   * Optional validator that can be overridden by endpoint subclasses to validate or transform
   * a provider result before it is written to the response cache and published to gRPC subscribers.
   * Runs after the transport has built the result and attached timestamps, but before the cache write.
   */
  protected resultValidator?(result: TimestampedProviderResult<T>): TimestampedProviderResult<T>

  requestTransforms: RequestTransform<T>[]
  overrides?: Record<string, string> | undefined
  customRouter?: (
    req: AdapterRequest<TypeFromDefinition<T['Parameters']>>,
    settings: T['Settings'],
  ) => string
  defaultTransport?: string
  enableCompositeTransport?: boolean

  constructor(params: AdapterEndpointParams<T>) {
    this.name = params.name
    this.aliases = params.aliases
    // These ifs are annoying but it's to make it type safe
    if ('transportRoutes' in params) {
      this.transportRoutes = params.transportRoutes
      this.customRouter = params.customRouter
      this.defaultTransport = params.defaultTransport
      this.enableCompositeTransport = params.enableCompositeTransport
      if (params.enableCompositeTransport && this.transportRoutes.routeNames().length < 2) {
        throw new AdapterError({
          statusCode: 400,
          message: `Composite transport requires at least 2 transports`,
        })
      }
    } else {
      this.transportRoutes = new TransportRoutes<T>().register(
        DEFAULT_TRANSPORT_NAME,
        params.transport,
      )
    }

    this.inputParameters = params.inputParameters || new InputParameters({})
    this.rateLimiting = params.rateLimiting
    this.cacheKeyGenerator = params.cacheKeyGenerator
    this.customInputValidation = params.customInputValidation
    this.customOutputValidation = params.customOutputValidation
    this.overrides = params.overrides
    this.inversionPolicy = params.inversionPolicy
    this.requestTransforms = [this.symbolOverrider.bind(this), ...(params.requestTransforms || [])]
  }

  /**
   * Performs all necessary initialization processes that are async or need async initialized dependencies
   *
   * @param dependencies - all dependencies initialized at the adapter level
   * @param adapterSettings - configuration for the adapter
   */
  async initialize(
    adapterName: string,
    dependencies: AdapterDependencies,
    adapterSettings: T['Settings'],
  ): Promise<void> {
    for (const param of this.inputParameters.params) {
      if (param.aliases.includes(INVERSION_PARAM)) {
        logger.warn(
          `Endpoint "${this.name}" defines input param "${param.name}" with the reserved name or alias "${INVERSION_PARAM}". Inversion requests bypass normal input validation; rename the param before enabling inversion.`,
        )
      }
    }

    if (this.inversionPolicy) {
      const { id, version } = this.inversionPolicy
      if (
        typeof id !== 'string' ||
        id.length === 0 ||
        !Number.isInteger(version) ||
        version <= 0 ||
        typeof this.inversionPolicy.transform !== 'function'
      ) {
        throw new AdapterError({
          statusCode: 500,
          message: `Endpoint "${this.name}" has an invalid inversion policy id/version`,
        })
      }
    }
    this.adapterName = adapterName
    const responseCache = new SimpleResponseCache({
      dependencies,
      adapterSettings: adapterSettings as AdapterSettings,
      adapterName,
      endpointName: this.name,
      inputParameters: this.inputParameters,
    })

    if (this.resultValidator) {
      responseCache.resultValidator = this.resultValidator.bind(this)
    }
    if (this.inversionPolicy) {
      responseCache.inversionPolicy = this.inversionPolicy
    }

    const transportDependencies = {
      ...dependencies,
      responseCache,
    }

    if (this.enableCompositeTransport && !adapterSettings.COMPOSITE_TRANSPORT) {
      logger.warn(
        `enableCompositeTransport true for endpoint "${this.name}", but COMPOSITE_TRANSPORT is not enabled`,
      )
    }

    if (this.enableCompositeTransport && adapterSettings.COMPOSITE_TRANSPORT) {
      logger.debug(`Enabling composite transport for endpoint "${this.name}"...`)
      this.transportRoutes = new TransportRoutes<T>().register(
        DEFAULT_TRANSPORT_NAME,
        new CompositeTransport(Object.fromEntries(this.transportRoutes.entries())),
      )
    }

    logger.debug(`Initializing transports for endpoint "${this.name}"...`)
    for (const [transportName, transport] of this.transportRoutes.entries()) {
      await transport.initialize(transportDependencies, adapterSettings, this.name, transportName)
    }
  }

  /**
   * Takes the incoming request and applies all request transforms in the adapter
   *
   * @param req - the current adapter request
   * @returns the request after passing through all request transforms
   */
  runRequestTransforms(
    req: AdapterRequest<TypeFromDefinition<T['Parameters']>>,
    settings: T['Settings'],
  ): void {
    for (const transform of this.requestTransforms) {
      transform(req, settings)
    }
  }

  /**
   * Applies the endpoint inversion policy to an immediate (foreground) response.
   * Cache responses are inverted by ResponseCache before being written.
   *
   * @param response - the immediate response returned by a transport
   * @param data - the validated request params
   * @returns the response with inversion applied when requested
   */
  applyInversionToResponse(
    response: AdapterResponse<T['Response']>,
    data: TypeFromDefinition<T['Parameters']>,
    transportName = DEFAULT_TRANSPORT_NAME,
  ): AdapterResponse<T['Response']> {
    const policy = this.inversionPolicy
    if (!hasInversionEnabled(data)) {
      return response
    }

    const timestamps = (response as TimestampedAdapterResponse<T['Response']>).timestamps
    if (response.errorMessage) {
      this.recordInversionMetric('skipped', policy?.id ?? 'none', transportName)
      return response
    }

    if (!policy) {
      this.recordInversionMetric('rejected', 'none', transportName)
      return {
        statusCode: 502,
        errorMessage: 'Inversion failed: endpoint has no inversion policy',
        timestamps,
      }
    }

    const params = tryClone(data) ?? { ...data }
    const clonedResponse = tryClone(response)
    let result: TimestampedProviderResult<T>
    if (!clonedResponse) {
      result = this.inversionFailure(
        params,
        timestamps,
        'Inversion failed: response could not be cloned',
      )
    } else {
      try {
        result =
          ensureProviderResult(
            policy.transform({
              params: tryClone(params) ?? { ...params },
              response: clonedResponse as TimestampedAdapterResponse<T['Response']>,
            }),
            { params, response: response as TimestampedAdapterResponse<T['Response']> },
          ) ??
          this.inversionFailure(
            params,
            timestamps,
            'Inversion failed: policy returned an invalid result',
          )
      } catch (error) {
        const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
        const safeDetail = censor(detail, CensorList.getAll()) ?? detail
        censorLogs(() => logger.warn(`Inversion policy threw: ${safeDetail}`))
        result = this.inversionFailure(
          params,
          timestamps,
          `Inversion failed: policy transform threw: ${safeDetail}`,
        )
      }
    }

    let finalResponse = result.response as AdapterResponse<T['Response']>
    let status: 'applied' | 'rejected' = result.response.errorMessage ? 'rejected' : 'applied'
    if (status === 'applied' && this.resultValidator) {
      try {
        const validated = ensureProviderResult(
          this.resultValidator({
            ...result,
            params: tryClone(result.params) ?? { ...result.params },
          }),
          result,
        )
        if (!validated) {
          finalResponse = {
            statusCode: 502,
            errorMessage: 'Inversion failed: result validator returned an invalid result',
            timestamps,
          }
          status = 'rejected'
        } else {
          finalResponse = validated.response as AdapterResponse<T['Response']>
        }
      } catch (error) {
        const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
        const safeDetail = censor(detail, CensorList.getAll()) ?? detail
        censorLogs(() => logger.warn(`Inversion result validator threw: ${safeDetail}`))
        finalResponse = {
          statusCode: 502,
          errorMessage: `Inversion failed: result validator threw: ${safeDetail}`,
          timestamps,
        }
        status = 'rejected'
      }
    }

    this.recordInversionMetric(status, policy.id, transportName)
    return finalResponse
  }

  private inversionFailure(
    params: TypeFromDefinition<T['Parameters']>,
    timestamps: TimestampedProviderResult<T>['response']['timestamps'],
    message: string,
  ): TimestampedProviderResult<T> {
    return {
      params,
      response: {
        statusCode: 502,
        errorMessage: message,
        timestamps,
      },
    }
  }

  private recordInversionMetric(
    status: 'applied' | 'rejected' | 'skipped',
    policyId: string,
    transportName: string,
  ): void {
    metrics
      .get('inversionTotal')
      .labels({
        adapter_endpoint: this.name,
        policy: policyId,
        status,
        transport: transportName,
      })
      .inc()
  }

  getRequestOverrides(data: Record<string, string>, overrides?: Overrides) {
    const overrideAdapterName = getCanonicalAdapterName(data['adapterNameOverride'])
    const adapterName = getCanonicalAdapterName(this.adapterName)
    const canonicalOverrides: Overrides | undefined = canonicalizeAdapterNameKeys(overrides)
    return canonicalOverrides?.[overrideAdapterName] || canonicalOverrides?.[adapterName]
  }

  /**
   * Default request transform that takes requests and manipulates base params
   *
   * @param adapter - the current adapter
   * @param req - the current adapter request
   * @returns the modified (or new) request
   */
  symbolOverrider(req: AdapterRequest<TypeFromDefinition<T['Parameters']>>) {
    const data = req.requestContext.data as Record<string, string>
    const rawRequestBody = req.body as { data?: { overrides?: Overrides } }
    const requestOverrides = this.getRequestOverrides(data, rawRequestBody.data?.overrides)
    const base = data['base']
    if (requestOverrides?.[base]) {
      // Perform overrides specified in the request payload
      data['base'] = requestOverrides[base]
    } else if (this.overrides?.[base]) {
      // Perform hardcoded adapter overrides
      data['base'] = this.overrides[base]
    }

    return req
  }

  getTransportNameForRequest(
    req: AdapterRequest<TypeFromDefinition<T['Parameters']>>,
    settings: T['Settings'],
  ): string {
    // If there's only one transport, return it
    if (this.transportRoutes.get(DEFAULT_TRANSPORT_NAME)) {
      return DEFAULT_TRANSPORT_NAME
    }

    // Attempt to get the transport to use from:
    //   1. Custom router (whatever logic the user wrote)
    //   2. Default router (try to get it from the input params)
    //   3. Default transport (if it was specified in the instance params)
    const rawTransportName =
      (this.customRouter && this.customRouter(req, settings)) ||
      this.defaultRouter(req) ||
      this.defaultTransport

    if (!rawTransportName) {
      throw new AdapterError({
        statusCode: 400,
        message: `No result was fetched from a custom router, no transport was specified in the input parameters, and this endpoint does not have a default transport set.`,
      })
    }

    const transportName = rawTransportName.toLowerCase()
    if (!this.transportRoutes.get(transportName)) {
      throw new AdapterError({
        statusCode: 400,
        message: `No transport found for key "${transportName}", must be one of ${JSON.stringify(
          this.transportRoutes.routeNames(),
        )}`,
      })
    }

    logger.debug(`Request will be routed to transport "${transportName}"`)
    return transportName
  }

  /**
   * Default routing strategy. Will try and use the transport override if present
   * or transport input parameter in the request body.
   *
   * @param req - The current adapter request
   * @returns the transport param or override if present
   */
  private defaultRouter(req: AdapterRequest<TypeFromDefinition<T['Parameters']>>) {
    // DefaultRouter is called before customInputValidation, so we don't have
    // the validation data on the requestContext yet.
    const data: Record<string, string> = {}
    const rawRequestBody = req.body as unknown as { data: AdapterRequestData }
    const requestOverrides = this.getRequestOverrides(data, rawRequestBody.data?.overrides)
    // Transport override
    if (requestOverrides?.['transport']) {
      return requestOverrides['transport']
    }
    return rawRequestBody.data?.transport
  }
}
