import { FastifyError, FastifyReply, FastifyRequest, HookHandlerDoneFunction } from 'fastify'
import { Adapter } from '../adapter'
import { calculateCacheKey, recordRedisCommandMetric } from '../cache'
import { getMetricsMeta } from '../metrics/util'
import { makeLogger } from '../util'
import { AdapterMiddlewareBuilder, AdapterRequest, AdapterRequestBody } from '../util/types'
import { AdapterError, AdapterInputError } from './error'
import { CMD_SENT_STATUS } from '../cache/metrics'
import { ReplyError as RedisError } from 'ioredis'
export { InputParameters } from './input-params'

const errorCatcherLogger = makeLogger('ErrorCatchingMiddleware')

export const validatorMiddleware: AdapterMiddlewareBuilder =
  (adapter: Adapter) =>
  (req: AdapterRequest, reply: FastifyReply, done: HookHandlerDoneFunction) => {
    if (req.headers['content-type'] !== 'application/json') {
      throw new AdapterInputError({
        message: 'Content type not "application/json", returning 400',
        statusCode: 400,
      })
    }

    if (!req.body) {
      throw new AdapterInputError({
        message: 'Body not present in adapter request, returning 400',
        statusCode: 400,
      })
    }

    // We can restrict usage of the raw request body everywhere in the framework
    // by setting its type to EmptyBody, and we cast here (and only here)
    const requestBody = req.body as unknown as AdapterRequestBody

    // Make endpoints case insensitive
    const endpointParam =
      requestBody.endpoint?.toLowerCase() ||
      requestBody.data?.endpoint?.toLowerCase() ||
      adapter.defaultEndpoint
    if (!endpointParam) {
      throw new AdapterInputError({
        message: `Request body does not specify an endpoint, and there is no default endpoint configured for this adapter.`,
        statusCode: 400,
      })
    }

    const endpoint = adapter.endpointsMap[endpointParam]
    if (!endpoint) {
      throw new AdapterInputError({
        message: `Adapter does not have a "${endpointParam}" endpoint.`,
        statusCode: 404,
      })
    }

    const validatedData = endpoint.validator.validateInput(requestBody.data)

    req.requestContext = {
      cacheKey: '',
      data: validatedData,
      endpointName: endpoint.name,
    }

    if (adapter.config.METRICS_ENABLED && adapter.config.EXPERIMENTAL_METRICS_ENABLED) {
      // Add metrics meta which includes feedId to the request
      // Perform prior to overrides to maintain consistent Feed IDs across adapters
      const metrics = getMetricsMeta(
        {
          inputParameters: endpoint.inputParameters,
          adapterConfig: adapter.config,
        },
        validatedData,
      )
      req.requestContext = { ...req.requestContext, meta: { metrics } }
    }

    // Run any request transforms that might have been defined in the adapter.
    // This is the last time modifications are supposed to happen to the request.
    adapter.runRequestTransforms(req)

    // Now that all the transformations have been applied, all that's left is calculating the cache key
    if (endpoint.cacheKeyGenerator) {
      let cacheKey
      cacheKey = endpoint.cacheKeyGenerator(req.requestContext.data)
      if (cacheKey.length > adapter.config.MAX_COMMON_KEY_SIZE) {
        errorCatcherLogger.warn(
          `Generated custom cache key for adapter request is bigger than the MAX_COMMON_KEY_SIZE and will be truncated`,
        )
        cacheKey = cacheKey.slice(0, adapter.config.MAX_COMMON_KEY_SIZE)
      }
      req.requestContext.cacheKey = cacheKey
    } else {
      req.requestContext.cacheKey = calculateCacheKey(
        {
          endpointName: endpoint.name,
          inputParameters: endpoint.inputParameters,
          adapterConfig: adapter.config,
        },
        req.requestContext.data,
      )
    }

    done()
  }

export const errorCatchingMiddleware = (err: Error, req: FastifyRequest, res: FastifyReply) => {
  // Add adapter or generic error to request meta for metrics use
  // There's a chance we have no request context if there was an error during input validation
  if (req.requestContext) {
    req.requestContext.meta = { ...req.requestContext?.meta, error: err }
  }

  // Add the request context to the error so that we can check things like incoming params, endpoint, etc
  const errorWithContext = {
    requestContext: req.requestContext,
    ...err,
  }

  if (err instanceof AdapterError) {
    // We want to log these as warn, because although they are to be expected, NOPs should
    // Only use "correct" job specs and therefore not hit adapters with invalid requests.
    errorCatcherLogger.warn(errorWithContext)
    res.status(err.statusCode).send(err.toJSONResponse())
  } else if (err instanceof RedisError) {
    // Native ioredis error
    errorCatcherLogger.warn(errorWithContext)
    const replyError = err as typeof RedisError
    if (process.env['METRICS_ENABLED']) {
      recordRedisCommandMetric(CMD_SENT_STATUS.FAIL, replyError.command?.name)
    }
    res.status(500).send(replyError.message || 'There was an unexpected error with the Redis cache')
  } else if (err.name === 'FastifyError') {
    errorCatcherLogger.error(errorWithContext)
    res.status((err as FastifyError).statusCode as number).send(err.message)
  } else {
    errorCatcherLogger.error(errorWithContext)
    res.status(500).send(err.message || 'There was an unexpected error in the adapter.')
  }
}
