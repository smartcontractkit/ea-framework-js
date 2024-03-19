import { TransportGenerics } from '../transports'
import { AdapterEndpoint } from './endpoint'
import { AdapterConfig, SettingsDefinitionMap } from '../config'
import { Adapter } from './basic'
import { AdapterParams } from './types'
import { EmptyInputParameters, InputParametersDefinition } from '../validation/input-params'
import { AdapterRequest, AdapterResponse } from '../util'
import { metrics } from '../metrics'

export type PoRProviderResponse = {
  Result: number
  Data: {
    result: number
    ripcord: boolean
  }
}

export type PoRAddress = Record<string, unknown> & {
  network: string
  chainId: string
  address: string
}

export type PoRAddressResponse = {
  Result: null
  Data: {
    result: PoRAddress[]
  }
}

/**
 * Helper type structure that contains the Response type passed to the generic parameters of an AddressEndpoint
 */
export type PoRAddressEndpointGenerics = TransportGenerics & {
  Response: PoRAddressResponse
}

/**
 * A PoRAddressEndpoint is a specific type of AdapterEndpoint. Meant to comply with standard practices for
 * Data Feeds, its response type must be `PoRAddressResponse`
 */
export class PoRAddressEndpoint<T extends PoRAddressEndpointGenerics> extends AdapterEndpoint<T> {}

export type PoRBalance = Record<string, unknown> & {
  balance: string
}

export type PoRBalanceResponse = {
  Result: null
  Data: {
    result: PoRBalance[]
  }
}

/**
 * Type for the base input parameter config that any [[PoRBalanceEndpoint]] must extend
 */
export type PoRBalanceEndpointInputParametersDefinition = InputParametersDefinition & {
  addresses: {
    aliases: readonly ['result', ...string[]]
    required: boolean
    array: boolean
    description: 'An array of addresses to get the balances of (as an object with string `address` as an attribute)'
    type: {
      address: {
        type: 'string'
        description: 'an address to get the balance of'
        required: true
      }
    }
  }
}

/**
 * Base input parameter config that any [[PoRBalanceEndpoint]] must extend
 */
export const porBalanceEndpointInputParametersDefinition = {
  addresses: {
    aliases: ['result'],
    array: true,
    type: {
      address: {
        type: 'string',
        description: 'an address to get the balance of',
        required: true,
      },
    },
    description:
      'An array of addresses to get the balances of (as an object with string `address` as an attribute)',
    required: true,
  },
} as const satisfies PoRBalanceEndpointInputParametersDefinition

/**
 * Helper type structure that contains the different types passed to the generic parameters of a BalanceEndpoint
 */
export type PoRBalanceEndpointGenerics = TransportGenerics & {
  Parameters: PoRBalanceEndpointInputParametersDefinition
  Response: PoRBalanceResponse
}

/**
 * A PoRBalanceEndpoint is a specific type of AdapterEndpoint. Meant to comply with standard practices for
 * Data Feeds, its InputParameters must extend the basic ones (addresses) and the response type must be `PoRBalanceResponse`.
 */
export class PoRBalanceEndpoint<T extends PoRBalanceEndpointGenerics> extends AdapterEndpoint<T> {}

/**
 * Helper type structure that contains the different types passed to the generic parameters of TotalBalanceEndpoint
 */
export type PoRTotalBalanceEndpointGenerics = TransportGenerics & {
  Parameters: PoRBalanceEndpointInputParametersDefinition
  Response: {
    Result: string
    Data: {
      result: string
    }
  }
}

/**
 * A PoRTotalBalanceEndpoint is a specific type of AdapterEndpoint. Meant to comply with standard practices for
 * Data Feeds, its InputParameters must extend the basic ones (addresses) and the response type must be numeric string.
 */
export class PoRTotalBalanceEndpoint<
  T extends PoRTotalBalanceEndpointGenerics,
> extends AdapterEndpoint<T> {}

export type PoRProviderEndpointGenerics = TransportGenerics & {
  Response: PoRProviderResponse
}

/**
 * A PoRProviderEndpoint is a specific type of AdapterEndpoint. Meant to comply with standard practices for
 * Data Feeds, the response type must be `PoRProviderResponse`.
 */
export class PoRProviderEndpoint<T extends PoRProviderEndpointGenerics> extends AdapterEndpoint<T> {}

/**
 * A PoRAdapter is a specific kind of Adapter that includes at least one PoRTotalBalanceEndpoint,
 * PoRBalanceEndpoint, PoRAddressEndpoint or PoRProviderEndpoint.
 */
export class PoRAdapter<T extends SettingsDefinitionMap> extends Adapter<T> {
  constructor(params: AdapterParams<T>) {
    // PoR requests take longer to process than normal feeds, that's why by default we set
    // BACKGROUND_EXECUTE_TIMEOUT to the highest value
    if (!params.config) {
      params.config = new AdapterConfig(
        {},
        {
          envDefaultOverrides: {
            BACKGROUND_EXECUTE_TIMEOUT: 180_000,
            API_TIMEOUT: 60_000,
            CACHE_MAX_AGE: 360_000,
          },
        },
      ) as AdapterConfig<T>
    } else {
      params.config.options = {
        ...(params.config.options || {}),
        envDefaultOverrides: {
          ...(params.config.options?.envDefaultOverrides || {}),
          BACKGROUND_EXECUTE_TIMEOUT:
            params.config.options?.envDefaultOverrides?.BACKGROUND_EXECUTE_TIMEOUT ?? 180_000,
          API_TIMEOUT: params.config.options?.envDefaultOverrides?.API_TIMEOUT ?? 60_000,
          CACHE_MAX_AGE: params.config.options?.envDefaultOverrides?.CACHE_MAX_AGE ?? 360_000,
        },
      }
    }
    const porEndpoints = params.endpoints.filter(
      (e) =>
        e instanceof PoRBalanceEndpoint ||
        e instanceof PoRTotalBalanceEndpoint ||
        e instanceof PoRAddressEndpoint ||
        e instanceof PoRProviderEndpoint,
    )
    if (!porEndpoints.length) {
      throw new Error(`This PoRAdapter's list of endpoints does not contain a valid PoR endpoint`)
    }

    super(params)
  }

  override async handleRequest(
    req: AdapterRequest<EmptyInputParameters>,
    replySent: Promise<unknown>,
  ): Promise<Readonly<AdapterResponse>> {
    const endpoint = this.endpoints.find((e) => e.name === req.requestContext.endpointName)

    if (endpoint instanceof PoRBalanceEndpoint || endpoint instanceof PoRTotalBalanceEndpoint) {
      const data = req.requestContext.data as { addresses: { address: string }[] }
      if (data && data.addresses && Array.isArray(data.addresses)) {
        const feedId = req.requestContext?.meta?.metrics?.feedId || 'N/A'
        metrics
          .get('porBalanceAddressLength')
          .labels({ feed_id: feedId })
          .set(data.addresses.length)
      }
    }
    return super.handleRequest(req, replySent)
  }
}
