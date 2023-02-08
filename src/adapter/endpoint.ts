import { ResponseCache } from '../cache/response'
import { AdapterConfig } from '../config'
import { MetaTransport, Transport } from '../transports'
import { makeLogger } from '../util'
import { SpecificInputParameters } from '../validation'
import { InputValidator } from '../validation/input-validator'
import {
  AdapterDependencies,
  AdapterEndpointParams,
  CustomInputValidator,
  EndpointGenerics,
  EndpointRateLimitingConfig,
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

  constructor(params: AdapterEndpointParams<T>) {
    this.name = params.name
    this.aliases = params.aliases
    this.transport = params.transport
    this.inputParameters = params.inputParameters
    this.rateLimiting = params.rateLimiting
    this.validator = new InputValidator(this.inputParameters)
    this.cacheKeyGenerator = params.cacheKeyGenerator
    this.customInputValidation = params.customInputValidation
  }

  /**
   * Performs all necessary initialization processes that are async or need async initialized dependencies
   *
   * @param dependencies - all dependencies initialized at the adapter level
   * @param config - configuration for the adapter
   */
  async initialize(
    dependencies: AdapterDependencies,
    config: AdapterConfig<T['CustomSettings']>,
  ): Promise<void> {
    const responseCache = new ResponseCache({
      dependencies,
      config: config as AdapterConfig,
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
}
