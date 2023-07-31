import { TransportGenerics } from '../transports'
import { AdapterEndpoint } from './endpoint'

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
