import { SettingsDefinitionMap } from '../config'
import { AdapterRequest, AdapterRequestContext, AdapterResponse } from '../util'
import { InputParameter, InputParametersDefinition } from '../validation/input-params'
import { AdapterEndpoint } from './endpoint'
import { Adapter, AdapterEndpointParams, AdapterParams, PriceEndpointGenerics } from './index'

/**
 * Type for the base input parameter config that any [[PriceEndpoint]] must extend
 */
export type PriceEndpointInputParameters = InputParametersDefinition & {
  base: InputParameter & {
    aliases: readonly ['from', 'coin', ...string[]]
    type: 'string'
    description: 'The symbol of symbols of the currency to query'
  }
  quote: InputParameter & {
    aliases: readonly ['to', 'market', ...string[]]
    type: 'string'
    description: 'The symbol of the currency to convert to'
  }
}

/**
 * Base input parameter config that any [[PriceEndpoint]] must extend
 */
export const priceEndpointInputParameters = {
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
} as const satisfies PriceEndpointInputParameters

/**
 * Structure of an "includes" file.
 * Include pairs describe an incoming price feed request, and the details specify
 */
export type IncludesFile = IncludePair[]
type IncludeDetails = {
  from: string
  to: string
  inverse: boolean
}
type IncludePair = {
  from: string
  to: string
  includes: IncludeDetails[]
}
type IncludesMap = Record<string, Record<string, IncludeDetails>>

/**
 * A PriceEndpoint is a specific type of AdapterEndpoint. Meant to comply with standard practices for
 * Data Feeds, its InputParameters must extend the basic ones (base/quote).
 */
export class PriceEndpoint<T extends PriceEndpointGenerics> extends AdapterEndpoint<T> {
  constructor(
    params: AdapterEndpointParams<T> & {
      inputParametersDefinition: PriceEndpointInputParameters
    },
  ) {
    super(params)
  }
}

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

type PriceAdapterRequest<T extends InputParametersDefinition> = AdapterRequest<T> & {
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

      const requestTransform = (req: AdapterRequest<InputParametersDefinition>) => {
        const priceRequest = req as PriceAdapterRequest<PriceEndpointInputParameters>
        const requestData = priceRequest.requestContext.data
        const includesDetails = this.includesMap?.[requestData.base]?.[requestData.quote]

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
    req: PriceAdapterRequest<PriceEndpointInputParameters>,
    replySent: Promise<unknown>,
  ): Promise<AdapterResponse> {
    const response = await super.handleRequest(req, replySent)

    if (this.includesMap && req.requestContext.priceMeta?.inverse) {
      // We need to search in the reverse order (quote -> base) because the request transform will have inverted the pair
      const cloneResponse = { ...response }
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
  constructor(
    params: AdapterEndpointParams<T> & {
      inputParametersDefinition: PriceEndpointInputParameters
    },
  ) {
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
