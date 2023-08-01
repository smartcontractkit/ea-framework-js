import { TransportGenerics } from '../transports'
import { AdapterEndpoint } from './endpoint'
import { SettingsDefinitionMap } from '../config'
import { Adapter } from './basic'
import { AdapterParams } from './types'
import { InputParametersDefinition } from '../validation/input-params'

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

/**
 * A PoRAdapter is a specific kind of Adapter that includes at least one PoRTotalBalanceEndpoint,
 * PoRBalanceEndpoint or PoRAddressEndpoint.
 */
export class PoRAdapter<T extends SettingsDefinitionMap> extends Adapter<T> {
  constructor(params: AdapterParams<T>) {
    const porEndpoints = params.endpoints.filter(
      (e) =>
        e instanceof PoRBalanceEndpoint ||
        e instanceof PoRTotalBalanceEndpoint ||
        e instanceof PoRAddressEndpoint,
    )
    if (!porEndpoints.length) {
      throw new Error(`This PoRAdapter's list of endpoints does not contain a valid PoR endpoint`)
    }

    super(params)
    // PoR requests take longer to process than normal feeds, that's why we set
    // BACKGROUND_EXECUTE_TIMEOUT to the highest value
    this.config.settings.BACKGROUND_EXECUTE_TIMEOUT = 180_000
  }
}
