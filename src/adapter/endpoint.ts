import { ResponseCache } from '../cache/response'
import { AdapterSettings } from '../config'
import { TransportRoutes } from '../transports'
import { AdapterRequest, AdapterRequestData, Overrides, makeLogger } from '../util'
import { InputParameters } from '../validation'
import { AdapterError } from '../validation/error'
import {
  AdapterDependencies,
  AdapterEndpointInterface,
  AdapterEndpointParams,
  CustomInputValidator,
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
  cacheKeyGenerator?: (data: Record<string, unknown>) => string
  customInputValidation?: CustomInputValidator<T>
  requestTransforms: RequestTransform<T>[]
  overrides?: Record<string, string> | undefined
  customRouter?: (req: AdapterRequest<T['Parameters']>, settings: T['Settings']) => string
  defaultTransport?: string

  constructor(params: AdapterEndpointParams<T>) {
    this.name = params.name
    this.aliases = params.aliases
    // These ifs are annoying but it's to make it type safe
    if ('transportRoutes' in params) {
      this.transportRoutes = params.transportRoutes
      this.customRouter = params.customRouter
      this.defaultTransport = params.defaultTransport
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
    this.overrides = params.overrides
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
  runRequestTransforms(req: AdapterRequest<T['Parameters']>): void {
    for (const transform of this.requestTransforms) {
      transform(req)
    }
  }

  /**
   * Default request transform that takes requests and manipulates base params
   *
   * @param adapter - the current adapter
   * @param req - the current adapter request
   * @returns the modified (or new) request
   */
  symbolOverrider(req: AdapterRequest<T['Parameters']>) {
    const rawRequestBody = req.body as { data?: { overrides?: Overrides } }
    const requestOverrides = rawRequestBody.data?.overrides?.[this.adapterName.toLowerCase()]
    const data = req.requestContext.data as Record<string, string>
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
    req: AdapterRequest<T['Parameters']>,
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
   * Default routing strategy. Will try and use the transport input parameter if present in the request body.
   *
   * @param req - The current adapter request
   * @returns the transport param if present
   */
  private defaultRouter(req: AdapterRequest<T['Parameters']>) {
    const rawRequestBody = req.body as unknown as { data: AdapterRequestData }
    return rawRequestBody.data?.transport
  }
}
