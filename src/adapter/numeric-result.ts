import { PriceEndpoint, PriceEndpointGenerics } from './price'
import { AdapterEndpointParams } from './types'
import { TimestampedProviderResult } from '../util'

/**
 * A NumericResultEndpoint is a specific type of PriceEndpoint that validates the numeric result
 * before it is written to the response cache. It is meant for single-number price endpoints where
 * a null, undefined, NaN, or non-finite result from the provider should surface as a 502 error,
 * enabling the Chainlink Node to fall back to the bridge cache (last known good value).
 */
export class NumericResultEndpoint<T extends PriceEndpointGenerics> extends PriceEndpoint<T> {
  acceptZeroValue: boolean

  constructor(params: AdapterEndpointParams<T> & { acceptZeroValue?: boolean }) {
    super(params)
    this.acceptZeroValue = params.acceptZeroValue ?? true
  }

  protected override resultValidator(
    result: TimestampedProviderResult<T>,
  ): TimestampedProviderResult<T> {
    if ('errorMessage' in result.response) {
      return result
    }

    const { result: value } = result.response
    if (!Number.isFinite(value) || (!this.acceptZeroValue && value === 0)) {
      return {
        params: result.params,
        response: {
          statusCode: 502,
          errorMessage: `Invalid numeric result: ${value}`,
          timestamps: result.response.timestamps,
        },
      }
    }

    return result
  }
}
