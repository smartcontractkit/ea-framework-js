import { SettingsDefinitionMap } from '../config'
import { TransportGenerics } from '../transports'
import { AdapterRequest, SingleNumberResultResponse, TimestampedProviderResult } from '../util'
import {
  EmptyInputParameters,
  InputParametersDefinition,
  TypeFromDefinition,
} from '../validation/input-params'
import { AdapterEndpoint } from './endpoint'
import { Adapter, AdapterEndpointParams, AdapterParams } from './index'

/**
 * Type for the base input parameter config that any [[PriceEndpoint]] must extend
 */
export type PriceEndpointInputParametersDefinition = InputParametersDefinition & {
  base: {
    aliases: readonly ['from', 'coin', ...string[]]
    type: 'string'
    description: 'The symbol of symbols of the currency to query'
    required?: boolean
  }
  quote: {
    aliases: readonly ['to', 'market', ...string[]]
    type: 'string'
    description: 'The symbol of the currency to convert to'
    required?: boolean
  }
}

/**
 * Base input parameter config that any [[PriceEndpoint]] must extend
 */
export const priceEndpointInputParametersDefinition = {
  base: {
    aliases: ['from', 'coin'],
    type: 'string',
    description: 'The symbol of symbols of the currency to query',
    required: true,
  },
  quote: {
    aliases: ['to', 'market'],
    type: 'string',
    description: 'The symbol of the currency to convert to',
    required: true,
  },
} as const satisfies PriceEndpointInputParametersDefinition

/**
 * Structure of an "includes" file.
 * Include pairs describe an incoming price feed request, and the details specify
 */
export type IncludesFile = IncludePair[]
type IncludeDetails = {
  from: string
  to: string
  inverse: boolean
  endpoints?: string[]
}
type IncludePair = {
  from: string
  to: string
  includes: IncludeDetails[]
}
type IncludesMap = Record<string, Record<string, IncludeDetails>>

/**
 * Helper type structure that contains the different types passed to the generic parameters of a PriceEndpoint
 */
export type PriceEndpointGenerics = TransportGenerics & {
  Parameters: PriceEndpointInputParametersDefinition
  Response: SingleNumberResultResponse
}

/**
 * Inverts a single-value price response: result becomes 1 / result, and data.result is set to the
 * same value only when the data already has one.
 */
export const invertPrice = <D>({
  data,
  result,
}: {
  data: D
  result: number
}): { data: D; result: number } => {
  const inverted = 1 / result
  const dataWithResult =
    typeof data === 'object' && data !== null && 'result' in data
      ? { ...data, result: inverted }
      : data
  return { data: dataWithResult as D, result: inverted }
}

/**
 * A PriceEndpoint is a specific type of AdapterEndpoint. Meant to comply with standard practices for
 * Data Feeds, its InputParameters must extend the basic ones (base/quote).
 */
export class PriceEndpoint<T extends PriceEndpointGenerics> extends AdapterEndpoint<T> {}

const buildIncludesMap = (includesFile: IncludesFile) => {
  const includesMap: IncludesMap = {}

  for (const { from, to, includes } of includesFile) {
    if (!includesMap[from]) {
      includesMap[from] = {}
    }
    includesMap[from][to] = includes[0]
  }

  return includesMap
}

/**
 * A PriceAdapter is a specific kind of Adapter that includes at least one PriceEnpoint.
 */
export class PriceAdapter<
  CustomSettingsDefinition extends SettingsDefinitionMap,
> extends Adapter<CustomSettingsDefinition> {
  includesMap?: IncludesMap

  constructor(
    params: AdapterParams<CustomSettingsDefinition> & {
      includes?: IncludesFile
    },
  ) {
    const priceEndpoints = params.endpoints.filter(
      (e) => e instanceof PriceEndpoint,
    ) as PriceEndpoint<PriceEndpointGenerics>[]
    if (!priceEndpoints.length) {
      throw new Error(
        `This PriceAdapter's list of endpoints does not contain a valid PriceEndpoint`,
      )
    }

    super(params)

    if (params.includes) {
      // Build includes map for constant lookups
      this.includesMap = buildIncludesMap(params.includes)

      // The includes entry for this pair, or undefined. `applies` is false when the entry is restricted
      // to other endpoints.
      const findInclude = (endpointName: string, base?: string, quote?: string) => {
        const details = base && quote ? this.includesMap?.[base]?.[quote] : undefined
        const applies = details?.endpoints === undefined || details.endpoints.includes(endpointName)
        return { details, applies }
      }

      const pairRewrite = (req: AdapterRequest<EmptyInputParameters>) => {
        const requestData = (
          req as AdapterRequest<TypeFromDefinition<PriceEndpointInputParametersDefinition>>
        ).requestContext.data
        if (!requestData.base || !requestData.quote) {
          return
        }
        const { details, applies } = findInclude(
          req.requestContext.endpointName,
          requestData.base,
          requestData.quote,
        )
        if (!applies) {
          throw new Error(
            `Endpoint ${req.requestContext.endpointName} not supported for ${requestData.base}/${requestData.quote} in includes.json`,
          )
        }
        if (details) {
          requestData.base = details.from || requestData.base
          requestData.quote = details.to || requestData.quote
        }
      }

      for (const endpoint of priceEndpoints) {
        endpoint.invertsByDefault = (data) => {
          const { details, applies } = findInclude(endpoint.name, data.base, data.quote)
          return applies && details?.inverse === true
        }
        endpoint.pairRewrite = pairRewrite
        // Lets the cache serve inverse pairs from includes.json. This does not make the endpoint
        // accept `inversion: true`.
        endpoint.invertResponse ??= invertPrice
      }
    }
  }
}

const DEFAULT_ALIASES = ['crypto', 'price']

/**
 * A CryptoPriceEndpoint expands on the existing [[PriceEndpoint]], with the addition of adding
 * a set of common aliases that are used across EAs to specify endpoints that provide crypto prices.
 */
export class CryptoPriceEndpoint<T extends PriceEndpointGenerics> extends PriceEndpoint<T> {
  constructor(params: AdapterEndpointParams<T>) {
    if (!params.aliases) {
      params.aliases = []
    }
    for (const alias of DEFAULT_ALIASES) {
      if (params.name !== alias && !params.aliases.includes(alias)) {
        params.aliases.push(alias)
      }
    }

    super(params)
  }
}

/**
 * A ForexPriceEndpoint expands on the existing [[PriceEndpoint]] and provides more descriptive name for
 *  endpoints that provide forex prices.
 */
export class ForexPriceEndpoint<T extends PriceEndpointGenerics> extends PriceEndpoint<T> {
  constructor(params: AdapterEndpointParams<T>) {
    params.invertResponse ??= invertPrice
    super(params)
  }

  protected override resultValidator(
    result: TimestampedProviderResult<T>,
  ): TimestampedProviderResult<T> {
    if ('errorMessage' in result.response) {
      return result
    }
    const value = result.response.result
    if (typeof value !== 'number' || !Number.isFinite(value) || value === 0) {
      return {
        params: result.params,
        response: {
          statusCode: 502,
          errorMessage: `Invariant violation. Price result must be a finite, non-zero number. Got: ${value}`,
          timestamps: result.response.timestamps,
        },
      }
    }
    return result
  }
}
