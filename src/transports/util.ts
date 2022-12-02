import axios, { AxiosError, AxiosRequestConfig, AxiosResponse } from 'axios'
import { AdapterConfig, SettingsMap } from '../config'
import {
  AdapterConnectionError,
  AdapterDataProviderError,
  AdapterError,
  AdapterTimeoutError,
} from '../validation/error'
import * as transportMetrics from './metrics'
import { sleep } from '../util'

/**
 * Performs axios request along with metrics recording and error handling
 *
 * @param request - axios request config
 * @param config - the adapter config containing the env vars
 * @param checkForRateLimit - async function to check and wait for rate limit
 * @returns axios response for the request
 */
export async function axiosRequest<
  ProviderRequestBody,
  ProviderResponseBody,
  CustomSettings extends SettingsMap,
>(
  request: AxiosRequestConfig<ProviderRequestBody>,
  config: AdapterConfig<CustomSettings>,
  checkForRateLimit?: () => Promise<void>,
): Promise<AxiosResponse<ProviderResponseBody>> {
  const responseTimer = transportMetrics.dataProviderRequestDurationSeconds.startTimer()
  let providerResponse: AxiosResponse<ProviderResponseBody>
  const maxRetries = config.RETRY
  const initialExponent = 1

  const retry = async (exponent: number): Promise<AxiosResponse<ProviderResponseBody>> => {
    const _exponentialDelayRetry = async (exp: number) => {
      await sleep((2 ** exp + Math.random()) * 1000)
      if (checkForRateLimit) {
        await checkForRateLimit()
      }
      return retry(exp + 1)
    }

    try {
      request.timeout = config.API_TIMEOUT
      providerResponse = await axios.request<ProviderResponseBody>(request)
    } catch (e: unknown) {
      const error = e as AxiosError
      // Request error
      let providerStatusCode: number | undefined
      let adapterError: AdapterError
      if (error.code === 'ECONNABORTED') {
        providerStatusCode = error?.response?.status ?? 504
        adapterError = new AdapterTimeoutError({
          statusCode: 504,
          name: 'Data Provider Request Timeout error',
          providerStatusCode: error?.response?.status ?? 504,
          message: error?.message,
          cause: error,
          errorResponse: error?.response?.data,
          url: request.url,
        })

        // Record count of failed data provider request
        transportMetrics.dataProviderRequests
          .labels(transportMetrics.dataProviderMetricsLabel(providerStatusCode, request.method))
          .inc()

        throw adapterError
      }

      if (exponent >= maxRetries) {
        if (error?.response?.status) {
          adapterError = new AdapterDataProviderError({})
          providerStatusCode = error?.response?.status
        } else {
          adapterError = new AdapterConnectionError({})
          providerStatusCode = 0 // 0 -> connection error
        }
        // Record count of failed data provider request
        transportMetrics.dataProviderRequests
          .labels(transportMetrics.dataProviderMetricsLabel(providerStatusCode, request.method))
          .inc()

        adapterError.statusCode = 200
        adapterError.providerStatusCode = providerStatusCode
        adapterError.message = error?.message
        adapterError.cause = error
        adapterError.errorResponse = error?.response?.data
        adapterError.url = request.url

        throw adapterError
      }

      return _exponentialDelayRetry(exponent)
    } finally {
      // Record time taken for data provider request for success or failure
      responseTimer()
    }

    // Record count of successful data provider requests
    transportMetrics.dataProviderRequests
      .labels(transportMetrics.dataProviderMetricsLabel(providerResponse.status, request.method))
      .inc()

    return providerResponse
  }

  return retry(initialExponent)
}
