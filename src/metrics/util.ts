import { EndpointGenerics } from '../adapter'
import { calculateFeedId } from '../cache'
import { AdapterConfig } from '../config'
import { AdapterMetricsMeta, AdapterRequestData } from '../util'
import { InputParameters } from '../validation'

export const getMetricsMeta = <T extends EndpointGenerics>(
  args: {
    inputParameters: InputParameters
    adapterConfig: AdapterConfig<T['CustomSettings']>
  },
  data: AdapterRequestData,
): AdapterMetricsMeta => {
  const feedId = calculateFeedId(args, data)
  return { feedId }
}
