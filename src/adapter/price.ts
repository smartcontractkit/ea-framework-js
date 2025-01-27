import { SettingsDefinitionMap } from '../config'
import { TransportGenerics } from '../transports'
import {
  AdapterRequest,
  AdapterRequestContext,
  AdapterResponse,
  SingleNumberResultResponse,
} from '../util'
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
  endpoints: string[]
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

type PriceAdapterRequest<T> = AdapterRequest<T> & {
  requestContext: AdapterRequestContext<T> & {
    priceMeta: {
      inverse: boolean
    }
  }
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

      const requestTransform = (req: AdapterRequest<EmptyInputParameters>) => {
        const priceRequest = req as PriceAdapterRequest<
          TypeFromDefinition<PriceEndpointInputParametersDefinition>
        >
        const requestData = priceRequest.requestContext.data
        if (!requestData.base || !requestData.quote) {
          return
        }
        const includesDetails = this.includesMap?.[requestData.base]?.[requestData.quote]

        if (includesDetails?.endpoints.length === 0) {
          throw new Error(
            `No endpoints supported in includes.json for ${requestData.base}/${requestData.quote}.`,
          )
        }

        if (!includesDetails?.endpoints.includes(req.requestContext.endpointName)) {
          throw new Error(
            `Endpoint ${req.requestContext.endpointName} not supported for ${requestData.base}/${requestData.quote} in includes.json`,
          )
        }

        if (includesDetails) {
          requestData.base = includesDetails.from || requestData.base
          requestData.quote = includesDetails.to || requestData.quote
        }

        const inverse = includesDetails?.inverse || false
        priceRequest.requestContext.priceMeta = {
          inverse,
        }
      }

      for (const endpoint of priceEndpoints) {
        endpoint.requestTransforms?.push(requestTransform)
      }
    }
  }

  override async handleRequest(
    req: PriceAdapterRequest<PriceEndpointInputParametersDefinition>,
    replySent: Promise<unknown>,
  ): Promise<AdapterResponse> {
    const response = await super.handleRequest(req, replySent)

    if (this.includesMap && req.requestContext.priceMeta?.inverse) {
      // We need to search in the reverse order (quote -> base) because the request transform will have inverted the pair

      // Deep clone the response, as it may contain objects which won't be cloned by simply destructuring
      const cloneResponse = JSON.parse(JSON.stringify(response))

      const inverseResult = 1 / (cloneResponse.result as number)
      cloneResponse.result = inverseResult
      // Check if response data has a result within it
      const data = cloneResponse.data as { result: number } | null
      if (data?.result) {
        data.result = inverseResult
      }
      return cloneResponse
    }

    return response
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
export class ForexPriceEndpoint<T extends PriceEndpointGenerics> extends PriceEndpoint<T> {}
