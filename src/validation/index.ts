import { createHash } from 'crypto'
import { FastifyError, FastifyReply, FastifyRequest, HookHandlerDoneFunction } from 'fastify'
import { ReplyError as RedisError } from 'ioredis'
import { Adapter } from '../adapter'
import { calculateCacheKey } from '../cache'
import { CMD_SENT_STATUS, recordRedisCommandMetric } from '../metrics'
import { getMetricsMeta } from '../metrics/util'
import { censorLogs, makeLogger } from '../util'
import {
  AdapterMiddlewareBuilder,
  AdapterRequest,
  AdapterRequestBody,
  AdapterRequestContext,
} from '../util/types'
import { AdapterError, AdapterInputError, AdapterTimeoutError } from './error'
import {
  EmptyInputParameters,
  InputParametersDefinition,
  TypeFromDefinition,
  validateOverrides,
} from './input-params'
export { InputParameters } from './input-params'

const errorCatcherLogger = makeLogger('ErrorCatchingMiddleware')

export const validatorMiddleware: AdapterMiddlewareBuilder =
  (adapter: Adapter) =>
  (rawRequest: FastifyRequest, reply: FastifyReply, done: HookHandlerDoneFunction) => {
    const req = rawRequest as AdapterRequest<EmptyInputParameters>

    if (req.headers['content-type'] !== 'application/json') {
      throw new AdapterInputError({
        message: 'Content type not "application/json", returning 400',
        statusCode: 400,
      })
    }

    // We can restrict usage of the raw request body everywhere in the framework
    // by setting its type to EmptyBody, and we cast here (and only here)
    const requestBody = req.body as unknown as AdapterRequestBody

    // Assign empty object to data if it does not exist in the request
    requestBody.data = requestBody.data ?? {}

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

    // Validate the incoming data and normalize
    validateOverrides(requestBody.data)
    const validatedData = endpoint.inputParameters.validateInput(requestBody.data)

    req.requestContext = {
      cacheKey: '',
      data: validatedData,
      endpointName: endpoint.name,
    } as AdapterRequestContext<TypeFromDefinition<InputParametersDefinition>>

    // We do it afterwards so the custom routers can have a request with a requestContext fulfilled (sans transportName, ofc)
    req.requestContext.transportName = endpoint.getTransportNameForRequest(
      req,
      adapter.config.settings,
    )

    // Custom input validation defined in the EA
    const error =
      endpoint.customInputValidation && endpoint.customInputValidation(req, adapter.config.settings)

    if (error) {
      throw error
    }

    // Run any request transforms that might have been defined in the adapter.
    // This is the last time modifications are supposed to happen to the request.
    endpoint.runRequestTransforms(req, adapter.config.settings)

    if (
      adapter.config.settings.METRICS_ENABLED &&
      adapter.config.settings.EXPERIMENTAL_METRICS_ENABLED
    ) {
      // Add metrics meta which includes feedId to the request
      // Perform after overrides to maintain consistent Feed IDs across the same adapter
      const metrics = getMetricsMeta(
        {
          inputParameters: endpoint.inputParameters,
          adapterSettings: adapter.config.settings,
        },
        validatedData,
      )
      req.requestContext = { ...req.requestContext, meta: { metrics } }
    }

    // Now that all the transformations have been applied, all that's left is calculating the cache key
    if (endpoint.cacheKeyGenerator) {
      let cacheKey
      cacheKey = endpoint.cacheKeyGenerator(req.requestContext.data)
      if (cacheKey.length > adapter.config.settings.MAX_COMMON_KEY_SIZE) {
        errorCatcherLogger.warn(
          `Generated custom cache key for adapter request is bigger than the MAX_COMMON_KEY_SIZE and will be truncated`,
        )
        const shasum = createHash('sha1')
        shasum.update(cacheKey)
        cacheKey = shasum.digest('base64')
      }

      const cachePrefix = adapter.config.settings.CACHE_PREFIX
        ? `${adapter.config.settings.CACHE_PREFIX}-`
        : ''

      req.requestContext.cacheKey = `${cachePrefix}${cacheKey}`
    } else {
      const transportName = endpoint.getTransportNameForRequest(req, adapter.config.settings)
      req.requestContext.cacheKey = calculateCacheKey({
        data: req.requestContext.data,
        adapterName: adapter.name,
        endpointName: endpoint.name,
        transportName,
        adapterSettings: adapter.config.settings,
      })
    }

    done()
  }

export const errorCatchingMiddleware = (err: Error, req: FastifyRequest, res: FastifyReply) => {
  // Add adapter or generic error to request meta for metrics use
  // There's a chance we have no request context if there was an error during input validation,
  // but we still want to include error in meta for metrics
  if (req.requestContext) {
    req.requestContext.meta = { ...req.requestContext?.meta, error: err }
  } else {
    const errorLabel = 'inputValidationError'
    req.requestContext = {
      cacheKey: errorLabel,
      data: undefined,
      endpointName: errorLabel,
      transportName: errorLabel,
      meta: { error: err },
    }
  }

  // Add the request context to the error so that we can check things like incoming params, endpoint, etc
  const errorWithContext = {
    ...req.requestContext,
    error: {
      name: err.name,
      stack: err.stack,
      message: err.message,
    },
    reqBody: req.body,
  }

  if (err instanceof AdapterTimeoutError) {
    // AdapterTimeoutError are somewhat expected when the adapter doesn't find a response in the cache within the specified polling interval
    // This is common on startup so logging these errors as debug to help alleviate logs getting flooded in the beginning
    censorLogs(() => errorCatcherLogger.debug(errorWithContext))
    res.status(err.statusCode).send(err.toJSONResponse())
  } else if (err instanceof AdapterError) {
    // We want to log these as warn, because although they are to be expected, NOPs should
    // Only use "correct" job specs and therefore not hit adapters with invalid requests.
    censorLogs(() => errorCatcherLogger.warn(errorWithContext))
    res.status(err.statusCode).send(err.toJSONResponse())
  } else if (err instanceof RedisError) {
    // Native ioredis error
    censorLogs(() => errorCatcherLogger.warn(errorWithContext))
    const replyError = err as typeof RedisError
    if (process.env['METRICS_ENABLED']) {
      recordRedisCommandMetric(CMD_SENT_STATUS.FAIL, replyError.command?.name)
    }
    res.status(500).send(replyError.message || 'There was an unexpected error with the Redis cache')
  } else if (err.name === 'FastifyError') {
    censorLogs(() => errorCatcherLogger.error(errorWithContext))
    res.status((err as FastifyError).statusCode as number).send(err.message)
  } else {
    censorLogs(() => errorCatcherLogger.error(errorWithContext))
    res.status(500).send(err.message || 'There was an unexpected error in the adapter.')
  }
}
