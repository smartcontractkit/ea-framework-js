import { TransportGenerics } from '../transports'
import { TimestampedProviderResult } from '../util'
import { AdapterLWBAError } from '../validation/error'
import { AdapterEndpoint } from './endpoint'
import { AdapterEndpointParams, PriceEndpointInputParametersDefinition } from './index'

/**
 * Type for the base input parameter config that any [[LwbaEndpoint]] must extend
 */
export type LwbaEndpointInputParametersDefinition = PriceEndpointInputParametersDefinition

/**
 * Base input parameter config that any [[LwbaEndpoint]] must extend
 */
export const lwbaEndpointInputParametersDefinition = {
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
} as const satisfies LwbaEndpointInputParametersDefinition

export type LwbaResponseDataFields = {
  Result: null
  Data: {
    mid: number
    bid: number
    ask: number
  }
}

/**
 * Helper type structure that contains the different types passed to the generic parameters of a PriceEndpoint
 */
export type LwbaEndpointGenerics = TransportGenerics & {
  Parameters: LwbaEndpointInputParametersDefinition
  Response: LwbaResponseDataFields
}

export const DEFAULT_LWBA_ALIASES = ['crypto-lwba', 'crypto_lwba', 'cryptolwba']

export const validateLwbaResponse = (bid?: number, mid?: number, ask?: number): string => {
  if (!mid || !bid || !ask) {
    return `Invariant violation. LWBA response must contain mid, bid and ask prices. Got: (bid: ${bid}, mid: ${mid}, ask: ${ask})`
  }
  if (mid < bid || mid > ask) {
    return `Invariant violation. Mid price must be between bid and ask prices. Got: (bid: ${bid}, mid: ${mid}, ask: ${ask})`
  }
  return ''
}

/**
 * An LwbaEndpoint is a specific type of AdapterEndpoint. Meant to comply with standard practices for
 * LWBA (lightweight bid/ask) Data Feeds, its InputParameters must extend the basic ones (base/quote).
 */
export class LwbaEndpoint<T extends LwbaEndpointGenerics> extends AdapterEndpoint<T> {
  constructor(params: AdapterEndpointParams<T>) {
    if (!params.aliases) {
      params.aliases = []
    }
    for (const alias of DEFAULT_LWBA_ALIASES) {
      if (params.name !== alias && !params.aliases.includes(alias)) {
        params.aliases.push(alias)
      }
    }

    // Also validate on the response path for backwards compatibility with custom transports
    // that return responses directly from foregroundExecute.
    const existingValidation = params.customOutputValidation
    params.customOutputValidation = (output) => {
      if (existingValidation) {
        const result = existingValidation(output)
        if (result !== undefined) {
          return result
        }
      }

      if (output.statusCode !== 200) {
        return undefined
      }

      const data = output.data as LwbaResponseDataFields['Data']
      const error = validateLwbaResponse(data.bid, data.mid, data.ask)
      if (error) {
        throw new AdapterLWBAError({ statusCode: 500, message: error })
      }

      return undefined
    }

    super(params)
  }

  protected override resultValidator(
    result: TimestampedProviderResult<T>,
  ): TimestampedProviderResult<T> {
    if ('errorMessage' in result.response) {
      return result
    }

    const { bid, mid, ask } = result.response.data as LwbaResponseDataFields['Data']
    const error = validateLwbaResponse(bid, mid, ask)
    if (error) {
      return {
        params: result.params,
        response: {
          statusCode: 502,
          errorMessage: error,
          timestamps: result.response.timestamps,
        },
      }
    }

    return result
  }
}
