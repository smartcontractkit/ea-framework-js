import { EndpointGenerics } from '../adapter'
import { calculateFeedId } from '../cache'
import { AdapterMetricsMeta, AdapterRequestData } from '../util'
import { InputParameters } from '../validation'

export const getMetricsMeta = <T extends EndpointGenerics>(
  args: {
    inputParameters: InputParameters
    adapterSettings: T['Settings']
  },
  data: AdapterRequestData,
): AdapterMetricsMeta => {
  const feedId = calculateFeedId(args, data)
  return { feedId }
}
