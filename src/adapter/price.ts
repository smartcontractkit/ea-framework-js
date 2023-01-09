import { SettingsMap } from '../config'
import { AdapterRequest, AdapterRequestContext, AdapterResponse, RequestGenerics } from '../util'
import { AdapterEndpoint } from './endpoint'
import { Adapter, AdapterEndpointParams, AdapterParams, PriceEndpointGenerics } from './index'

/**
 * Type for the base input parameter config that any [[PriceEndpoint]] must extend
 */
export type PriceEndpointInputParameters = {
  base: {
    aliases: readonly ['from', 'coin', ...string[]]
    type: 'string'
    description: 'The symbol of symbols of the currency to query'
    required: boolean
  }
  quote: {
    aliases: readonly ['to', 'market', ...string[]]
    type: 'string'
    description: 'The symbol of the currency to convert to'
    required: boolean
  }
}

/**
 * Base input parameter config that any [[PriceEndpoint]] must extend
 */
export const priceEndpointInputParameters: PriceEndpointInputParameters = {
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
}

/**
 * Type for base input params for a PriceEndpoint
 */
export type PriceEndpointParams = {
  base: string
  quote: string
}

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
      inputParameters: PriceEndpointInputParameters
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

type PriceAdapterRequest<T extends RequestGenerics> = AdapterRequest<T> & {
  requestContext: AdapterRequestContext<T> & {
    priceMeta: {
      inverse: boolean
    }
  }
}

/**
 * A PriceAdapter is a specific kind of Adapter that includes at least one PriceEnpoint.
 */
export class PriceAdapter<CustomSettings extends SettingsMap> extends Adapter<CustomSettings> {
  includesMap?: IncludesMap

  constructor(
    params: AdapterParams<CustomSettings> & {
      includes?: IncludesFile
    },
  ) {
    // Doing this with types would be too complex to maintain
    if (!params.endpoints.some((e) => e instanceof PriceEndpoint)) {
      throw new Error(
        `This PriceAdapter's list of endpoints does not contain a valid PriceEndpoint`,
      )
    }

    super(params)

    if (params.includes) {
      // Build includes map for constant lookups
      this.includesMap = buildIncludesMap(params.includes)

      const requestTransform = (req: AdapterRequest) => {
        const priceRequest = req as PriceAdapterRequest<{
          Params: PriceEndpointParams
        }>
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

      this.requestTransforms?.push(requestTransform)
    }
  }

  override async handleRequest(
    req: PriceAdapterRequest<{
      Params: PriceEndpointParams
    }>,
    replySent: Promise<unknown>,
  ): Promise<AdapterResponse> {
    const response = await super.handleRequest(req, replySent)

    if (this.includesMap && req.requestContext.priceMeta.inverse) {
      // We need to search in the reverse order (quote -> base) because the request transform will have inverted the pair
      const inverseResult = 1 / (response.result as number)
      response.result = inverseResult
      // Check if response data has a result within it
      const data = response.data as { result: number } | null
      if (data?.result) {
        data.result = inverseResult
      }
    }

    return response
  }
}
