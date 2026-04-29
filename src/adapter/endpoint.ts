import { ResponseCache } from '../cache/response'
import { AdapterSettings } from '../config'
import { TransportRoutes } from '../transports'
import {
  AdapterRequest,
  AdapterRequestData,
  Overrides,
  makeLogger,
  getCanonicalAdapterName,
  canonicalizeAdapterNameKeys,
} from '../util'
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
  requestTransforms: RequestTransform<T>[]
  overrides?: Record<string, string> | undefined
  customRouter?: (
    req: AdapterRequest<TypeFromDefinition<T['Parameters']>>,
    settings: T['Settings'],
  ) => string
  defaultTransport?: string
  fallbackTransport?: Record<string, string>

  constructor(params: AdapterEndpointParams<T>) {
    this.name = params.name
    this.aliases = params.aliases
    // These ifs are annoying but it's to make it type safe
    if ('transportRoutes' in params) {
      this.transportRoutes = params.transportRoutes
      this.customRouter = params.customRouter
      this.defaultTransport = params.defaultTransport
      this.fallbackTransport = params.fallbackTransport
        ? Object.fromEntries(
            Object.entries(params.fallbackTransport).map(([k, v]) => [
              k.toLowerCase(),
              v.toLowerCase(),
            ]),
          )
        : undefined
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
    this.requestTransforms = [this.symbolOverrider.bind(this), ...(params.requestTransforms || [])]

    this.validateFallbackTransport()
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
    this.adapterName = adapterName
    const responseCache = new ResponseCache({
      dependencies,
      adapterSettings: adapterSettings as AdapterSettings,
      adapterName,
      endpointName: this.name,
      inputParameters: this.inputParameters,
    })

    const transportDependencies = {
      ...dependencies,
      responseCache,
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

  getFallbackTransportNameForRequest(primaryTransportName: string, settings: T['Settings']) {
    if (!settings.TRANSPORT_FALLBACK_ENABLED || !this.fallbackTransport) {
      logger.trace('TRANSPORT_FALLBACK_ENABLED is false or fallbackTransport is not set')
      return
    }

    const fallbackTransportName = this.fallbackTransport[primaryTransportName.toLowerCase()]

    if (fallbackTransportName) {
      logger.debug(`Request can fall back to transport "${fallbackTransportName}"`)
      return fallbackTransportName
    } else {
      logger.trace(`No fallback transport defined for "${primaryTransportName}"`)
    }
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

  private validateFallbackTransport() {
    if (this.cacheKeyGenerator && this.fallbackTransport) {
      throw new AdapterError({
        message: 'fallbackTransport not allowed for endpoints with cacheKeyGenerator',
        statusCode: 404,
      })
    }

    Object.entries(this.fallbackTransport || {}).forEach(([primary, fallback]) => {
      if (primary === fallback) {
        throw new AdapterError({
          statusCode: 400,
          message: `Fallback transport "${fallback}" cannot be the same as primary transport.`,
        })
      }

      if (!this.transportRoutes.get(primary)) {
        throw new AdapterError({
          statusCode: 400,
          message: `No primary transport found for key "${primary}", must be one of ${JSON.stringify(
            this.transportRoutes.routeNames(),
          )}`,
        })
      }

      if (!this.transportRoutes.get(fallback)) {
        throw new AdapterError({
          statusCode: 400,
          message: `No fallback transport found for key "${fallback}", must be one of ${JSON.stringify(
            this.transportRoutes.routeNames(),
          )}`,
        })
      }
    })
  }
}
