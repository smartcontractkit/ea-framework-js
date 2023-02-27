import { ResponseCache } from '../cache/response'
import { AdapterConfig } from '../config'
import { MetaTransport, Transport } from '../transports'
import { AdapterRequest, makeLogger } from '../util'
import { SpecificInputParameters } from '../validation'
import { InputValidator } from '../validation/input-validator'
import {
  AdapterDependencies,
  AdapterEndpointParams,
  CustomInputValidator,
  EndpointGenerics,
  EndpointRateLimitingConfig,
  Overrides,
  RequestTransform,
} from './types'

const logger = makeLogger('AdapterEndpoint')
/**
 * Main class to represent an endpoint within an External Adapter
 */
export class AdapterEndpoint<T extends EndpointGenerics> implements AdapterEndpointParams<T> {
  name: string
  aliases?: string[] | undefined
  transport: Transport<T> | MetaTransport<T>
  inputParameters: SpecificInputParameters<T['Request']['Params']>
  rateLimiting?: EndpointRateLimitingConfig | undefined
  validator: InputValidator
  cacheKeyGenerator?: (data: Record<string, unknown>) => string
  customInputValidation?: CustomInputValidator<T>
  requestTransforms?: RequestTransform[]
  overrides?: Record<string, string> | undefined

  constructor(params: AdapterEndpointParams<T>) {
    this.name = params.name
    this.aliases = params.aliases
    this.transport = params.transport
    this.inputParameters = params.inputParameters
    this.rateLimiting = params.rateLimiting
    this.validator = new InputValidator(this.inputParameters)
    this.cacheKeyGenerator = params.cacheKeyGenerator
    this.customInputValidation = params.customInputValidation
    this.overrides = params.overrides
    this.requestTransforms = [this.symbolOverrider.bind(this), ...(params.requestTransforms || [])]
  }

  /**
   * Performs all necessary initialization processes that are async or need async initialized dependencies
   *
   * @param dependencies - all dependencies initialized at the adapter level
   * @param config - configuration for the adapter
   */
  async initialize(
    adapterName: string,
    dependencies: AdapterDependencies,
    config: AdapterConfig<T['CustomSettings']>,
  ): Promise<void> {
    const responseCache = new ResponseCache({
      dependencies,
      config: config as AdapterConfig,
      adapterName,
      endpointName: this.name,
      inputParameters: this.inputParameters,
    })

    const transportDependencies = {
      ...dependencies,
      responseCache,
    }

    logger.debug(`Initializing transport for endpoint "${this.name}"...`)
    await this.transport.initialize(transportDependencies, config, this.name)
  }

  /**
   * Takes the incoming request and applies all request transforms in the adapter
   *
   * @param req - the current adapter request
   * @returns the request after passing through all request transforms
   */
  runRequestTransforms(req: AdapterRequest): void {
    if (!this.requestTransforms) {
      return
    }

    for (const transform of this.requestTransforms) {
      transform(req)
    }
  }

  /**
   * Default request transform that takes requests and manipulates
   *
   * @param adapter - the current adapter
   * @param req - the current adapter request
   * @returns the modified (or new) request
   */
  symbolOverrider(req: AdapterRequest) {
    const rawRequestBody = req.body as { data?: { overrides?: Overrides } }
    const requestOverrides = rawRequestBody.data?.overrides?.[this.name.toLowerCase()]
    const base = req.requestContext.data['base'] as string

    if (requestOverrides?.[base]) {
      // Perform overrides specified in the request payload
      req.requestContext.data['base'] = requestOverrides[base]
    } else if (this.overrides?.[base]) {
      // Perform hardcoded adapter overrides
      req.requestContext.data['base'] = this.overrides[base]
    }

    return req
  }
}
