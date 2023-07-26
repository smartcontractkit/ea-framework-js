import EventEmitter from 'events'
import { default as Redis } from 'ioredis'
import { Cache, CacheFactory, pollResponseFromCache } from '../cache'
import { cacheGet, cacheMetricsLabel } from '../cache/metrics'
import {
  AdapterConfig,
  BaseAdapterSettings,
  BaseSettingsDefinition,
  SettingsDefinitionMap,
} from '../config'
import { metrics } from '../metrics'
import {
  buildRateLimitTiersFromConfig,
  getRateLimitingTier,
  highestRateLimitTiers,
} from '../rate-limiting'
import { RateLimiterFactory, RateLimitingStrategy } from '../rate-limiting/factory'
import {
  AdapterRequest,
  AdapterResponse,
  LoggerFactoryProvider,
  SubscriptionSetFactory,
  censorLogs,
  makeLogger,
} from '../util'
import { Requester } from '../util/requester'
import { AdapterTimeoutError } from '../validation/error'
import { EmptyInputParameters } from '../validation/input-params'
import { AdapterEndpoint } from './endpoint'
import {
  AdapterDependencies,
  AdapterParams,
  AdapterRateLimitingConfig,
  EndpointGenerics,
} from './types'

const logger = makeLogger('Adapter')

/**
 * Main class to represent an External Adapter
 */
export class Adapter<CustomSettingsDefinition extends SettingsDefinitionMap = SettingsDefinitionMap>
  implements Omit<AdapterParams<CustomSettingsDefinition>, 'bootstrap'>
{
  // Adapter params
  name: Uppercase<string>
  defaultEndpoint?: string | undefined
  endpoints: AdapterEndpoint<EndpointGenerics>[]
  envDefaultOverrides?: Partial<BaseAdapterSettings> | undefined
  rateLimiting?: AdapterRateLimitingConfig | undefined
  envVarsPrefix?: string

  // After initialization
  initialized = false

  /** Object containing alias translations for all endpoints */
  endpointsMap: Record<string, AdapterEndpoint<EndpointGenerics>> = {}

  /** Initialized dependencies that the adapter will use */
  dependencies!: AdapterDependencies

  /** Configuration params for various adapter properties */
  config: AdapterConfig<CustomSettingsDefinition>

  /** Used on api shutdown for testing purposes*/
  shutdownNotifier: EventEmitter

  /** Bootstrap function that will run when initializing the adapter */
  private readonly bootstrap?: (adapter: Adapter<CustomSettingsDefinition>) => Promise<void>

  constructor(params: AdapterParams<CustomSettingsDefinition>) {
    // Copy over params
    this.name = params.name
    this.defaultEndpoint = params.defaultEndpoint?.toLowerCase()
    this.endpoints = params.endpoints as AdapterEndpoint<EndpointGenerics>[]
    this.rateLimiting = params.rateLimiting
    this.bootstrap = params.bootstrap
    this.config =
      params.config || (new AdapterConfig({}) as AdapterConfig<CustomSettingsDefinition>)

    this.config.initialize()
    this.normalizeEndpointNames()
    this.calculateRateLimitAllocations()
    this.shutdownNotifier = new EventEmitter()
  }

  /**
   * Initializes all of the [[Transport]]s in the adapter, passing along any [[AdapterDependencies]] and [[AdapterConfig]].
   * Additionally, it builds a map out of all the endpoint names and aliases (checking for duplicates).
   */
  async initialize(dependencies?: Partial<AdapterDependencies>) {
    // We initialize the logger first, separate from the rest of the dependency initialization
    // since we could have a custom logger to document the EA lifecycle since the beginning.
    LoggerFactoryProvider.set(dependencies?.loggerFactory)

    if (this.initialized) {
      throw new Error('This adapter has already been initialized!')
    }

    if (this.name !== this.name.toUpperCase()) {
      throw new Error('Adapter name must be uppercase')
    }

    // We do this after we have the logging factory provider initialized
    this.logRateLimitAllocations()

    // Initialize metrics to register them with the prom-client
    metrics.initialize()

    // Building configs during initialization to avoid validation errors during construction
    this.config.validate()

    // Log warnings for risks associated with certain configs and values
    this.logConfigWarnings()

    if (this.bootstrap) {
      await this.bootstrap(this)
    }

    this.dependencies = this.initializeDependencies(dependencies)

    if (this.config.settings.EA_MODE !== 'reader' && this.dependencies.cache.lock) {
      const cacheLockKey = this.config.settings.CACHE_PREFIX
        ? `${this.config.settings.CACHE_PREFIX}-${this.name}`
        : this.name

      await this.dependencies.cache.lock(
        cacheLockKey,
        this.config.settings.CACHE_LOCK_DURATION,
        this.config.settings.CACHE_LOCK_RETRIES,
        this.shutdownNotifier,
      )
    }

    for (const endpoint of this.endpoints) {
      // Add aliases to map to use in validation
      const aliases = [endpoint.name, ...(endpoint.aliases || [])]
      for (const alias of aliases) {
        if (this.endpointsMap[alias]) {
          throw new Error(`Duplicate endpoint / alias: "${alias}"`)
        }
        this.endpointsMap[alias] = endpoint
      }

      logger.debug(`Initializing endpoint "${endpoint.name}"...`)
      await endpoint.initialize(this.name, this.dependencies, this.config.settings)
    }

    // Build list of key/values that need to be redacted in logs
    // Populates the static array in CensorList to use in censor-transport
    this.config.buildCensorList()

    logger.debug('Adapter initialization complete.')
    this.initialized = true
  }

  /**
   * Takes an adapter and normalizes all endpoint names and aliases, as well as the default endpoint.
   * i.e. makes them lowercase for now
   */
  private normalizeEndpointNames() {
    for (const endpoint of this.endpoints) {
      endpoint.name = endpoint.name.toLowerCase()
      endpoint.aliases = endpoint.aliases?.map((a) => a.toLowerCase())
    }
  }

  /**
   * This function will take an adapter structure and go through each endpoint, calculating
   * each one's allocation of the total rate limits that are set for the adapter as a whole.
   *
   */
  private calculateRateLimitAllocations() {
    const numberOfEndpoints = this.endpoints.length
    const endpointsWithExplicitAllocations = this.endpoints.filter((e) => e.rateLimiting)

    const totalExplicitAllocation = endpointsWithExplicitAllocations
      .map((e) => e.rateLimiting?.allocationPercentage || 0)
      .reduce((sum, next) => sum + next, 0)

    if (totalExplicitAllocation > 100) {
      throw new Error('The total allocation set for all endpoints summed cannot exceed 100%')
    }

    if (
      totalExplicitAllocation === 100 &&
      numberOfEndpoints - endpointsWithExplicitAllocations.length > 0
    ) {
      throw new Error(
        'The explicit allocation is at 100% but there are endpoints with implicit allocation',
      )
    }

    const implicitAllocation = 100 - totalExplicitAllocation

    for (const endpoint of this.endpoints) {
      if (!endpoint.rateLimiting) {
        endpoint.rateLimiting = {
          allocationPercentage:
            implicitAllocation / (numberOfEndpoints - endpointsWithExplicitAllocations.length),
        }
      }
    }
  }

  private logRateLimitAllocations() {
    logger.debug('Adapter rate limit allocations:')
    for (const endpoint of this.endpoints) {
      logger.debug(`Endpoint [${endpoint.name}] - ${endpoint.rateLimiting?.allocationPercentage}%`)
    }
  }

  /**
   * Logs a warning for certain configs if set to particular values.
   * Used to warn stakeholders of potential risks.
   */
  private logConfigWarnings() {
    if (
      this.config.settings.LOG_LEVEL.toUpperCase() === 'DEBUG' ||
      this.config.settings.LOG_LEVEL.toUpperCase() === 'TRACE'
    ) {
      logger.warn(
        `LOG_LEVEL has been set to ${this.config.settings.LOG_LEVEL.toUpperCase()}. Setting higher log levels results in increased memory usage and potentially slower performance.`,
      )
    }
    if (this.config.settings.DEBUG === true) {
      logger.warn(`The adapter is running with DEBUG mode on.`)
    }
    if (this.config.settings.METRICS_ENABLED === false) {
      logger.warn(
        `METRICS_ENABLED has been set to false. Metrics should not be disabled in a production environment.`,
      )
    }
    if (
      this.config.settings.MAX_PAYLOAD_SIZE_LIMIT !==
      BaseSettingsDefinition.MAX_PAYLOAD_SIZE_LIMIT.default
    ) {
      logger.warn(
        `MAX_PAYLOAD_SIZE_LIMIT has been set to ${this.config.settings.MAX_PAYLOAD_SIZE_LIMIT}. This setting should only be set when absolutely necessary.`,
      )
    }
  }

  /**
   * This function will process dependencies for an adapter, such as caches or rate limiters,
   * in order to inject them into transports and other relevant places later in the lifecycle.
   *
   * @param inputDependencies - a partial obj of initialized dependencies to override the created ones
   * @returns a set of AdapterDependencies all initialized
   */
  initializeDependencies(inputDependencies?: Partial<AdapterDependencies>): AdapterDependencies {
    const dependencies = inputDependencies || {}

    if (
      this.config.settings.EA_MODE !== 'reader-writer' &&
      this.config.settings.CACHE_TYPE === 'local'
    ) {
      throw new Error(`EA mode cannot be ${this.config.settings.EA_MODE} while cache type is local`)
    }

    if (this.config.settings.CACHE_TYPE === 'redis' && !dependencies.redisClient) {
      const maxCooldown = this.config.settings.CACHE_REDIS_MAX_RECONNECT_COOLDOWN
      const redisOptions = {
        enableAutoPipelining: true, // This will make multiple commands be batch automatically
        host: this.config.settings.CACHE_REDIS_HOST,
        port: this.config.settings.CACHE_REDIS_PORT,
        password: this.config.settings.CACHE_REDIS_PASSWORD,
        path: this.config.settings.CACHE_REDIS_PATH, // If set, port and host are ignored
        timeout: this.config.settings.CACHE_REDIS_TIMEOUT,
        retryStrategy(times: number): number {
          metrics.get('redisRetriesCount').inc()
          logger.warn(`Redis reconnect attempt #${times}`)
          return Math.min(times * 100, maxCooldown) // Next reconnect attempt time
        },
        connectTimeout: this.config.settings.CACHE_REDIS_CONNECTION_TIMEOUT,
        maxRetriesPerRequest: 30, // Limits the number of retries before the adapter shuts down
      }
      if (this.config.settings.CACHE_REDIS_URL) {
        dependencies.redisClient = new Redis(this.config.settings.CACHE_REDIS_URL, redisOptions)
      } else {
        dependencies.redisClient = new Redis(redisOptions)
      }

      dependencies.redisClient.on('connect', () => {
        metrics.get('redisConnectionsOpen').inc()
      })
    }

    if (!dependencies.cache) {
      dependencies.cache = CacheFactory.buildCache(
        {
          cacheType: this.config.settings.CACHE_TYPE,
          maxSizeForLocalCache: this.config.settings.CACHE_MAX_ITEMS,
        },
        dependencies.redisClient,
      )
    }

    const rateLimitingTier = getRateLimitingTier(this.config.settings, this.rateLimiting?.tiers)

    if (rateLimitingTier) {
      for (const limit of Object.values(rateLimitingTier)) {
        if (limit && limit < 0) {
          throw new Error('Rate limit must be a positive number')
        }
      }
    }

    const highestTierValue = highestRateLimitTiers(this.rateLimiting?.tiers)
    const rateLimitTierFromConfig = buildRateLimitTiersFromConfig(this.config.settings)
    const perSecRateLimit = rateLimitTierFromConfig?.rateLimit1s || 0
    const perMinuteRateLimit = (rateLimitTierFromConfig?.rateLimit1m || 0) / 60

    if (perSecRateLimit > highestTierValue) {
      logger.warn(
        `The configured RATE_LIMIT_CAPACITY_SECOND value is higher than the highest tier value in the adapter rate limiting configurations ${highestTierValue}`,
      )
    }

    if (perMinuteRateLimit > highestTierValue) {
      logger.warn(
        `The configured ${
          this.config.settings.RATE_LIMIT_CAPACITY_MINUTE
            ? 'RATE_LIMIT_CAPACITY_MINUTE'
            : 'RATE_LIMIT_CAPACITY'
        } value (${perMinuteRateLimit}) is higher than the highest tier value the adapter rate limiting configurations (${
          highestTierValue * 60
        })`,
      )
    }

    if (!dependencies.rateLimiter) {
      dependencies.rateLimiter = RateLimiterFactory.buildRateLimiter(
        this.config.settings.RATE_LIMITING_STRATEGY as RateLimitingStrategy,
      ).initialize(this.endpoints, rateLimitingTier)
    }
    if (!dependencies.subscriptionSetFactory) {
      dependencies.subscriptionSetFactory = new SubscriptionSetFactory(
        this.config.settings,
        this.name,
        dependencies.redisClient,
      )
    }
    if (!dependencies.requester) {
      dependencies.requester = new Requester(dependencies.rateLimiter, this.config.settings)
    }

    return dependencies as AdapterDependencies
  }

  /**
   * Attempts to find a value from the Cache and return that if found.
   *
   * @param req - the incoming request to this adapter
   * @returns the cached value if exists
   */
  async findResponseInCache(
    req: AdapterRequest<EmptyInputParameters>,
  ): Promise<Readonly<AdapterResponse> | undefined> {
    const response = await (this.dependencies.cache as Cache<AdapterResponse>).get(
      req.requestContext.cacheKey,
    )

    if (response) {
      if (
        this.config.settings.METRICS_ENABLED &&
        this.config.settings.EXPERIMENTAL_METRICS_ENABLED
      ) {
        const label = cacheMetricsLabel(
          req.requestContext.cacheKey,
          req.requestContext.meta?.metrics?.feedId || 'N/A',
          this.config.settings.CACHE_TYPE,
        )

        // Record cache staleness and cache get count and value
        const now = Date.now()
        cacheGet(label, response.result, {
          cache: now - response.timestamps.providerDataReceivedUnixMs,
          total: response.timestamps.providerIndicatedTimeUnixMs
            ? now - response.timestamps.providerIndicatedTimeUnixMs
            : null,
        })
        req.requestContext.meta = {
          ...req.requestContext.meta,
          metrics: { ...req.requestContext.meta?.metrics, cacheHit: true },
        }
      }

      return response
    }
  }

  /**
   * Function to serve as middleware to pass along the AdapterRequest to the appropriate Transport (acc. to the endpoint in the req.)
   *
   * @param req - the incoming request to this adapter
   * @param replySent - a promise that resolves when the reply has already been sent
   * @returns a simple Promise when it's done
   */
  async handleRequest(
    req: AdapterRequest<EmptyInputParameters>,
    replySent: Promise<unknown>,
  ): Promise<Readonly<AdapterResponse>> {
    // Get transport, must be here because it's already checked in the validator
    const endpoint = this.endpointsMap[req.requestContext.endpointName]
    const transport = endpoint.transportRoutes.get(req.requestContext.transportName)

    // First try to find the response in our cache, keep it ready
    const cachedResponse = await this.findResponseInCache(req)

    // Next we fire off the transport's registration of the request if defined, regardless of if we already have a cached response.
    // This is necessary to ensure things like subscription sets are updated each time we get a request
    let requestRegistrationPromise: Promise<void> | undefined
    let requestRegistrationError: Error | undefined
    if (transport.registerRequest) {
      const handler = async () => {
        // If we already have a cached response, wait for it to be sent back before continuing with registration
        // This way we respond to incoming requests from the cache as fast as possible
        if (cachedResponse) {
          await replySent
        }

        try {
          // `await` is required to catch the error, you'll get an unhandled promise rejection otherwise
          // Disable non-null assertion operator because we already checked for the existence of registerRequest
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          return await transport.registerRequest!(req, this.config.settings)
        } catch (err) {
          censorLogs(() => logger.error(`Error registering request: ${err}`))
          requestRegistrationError = err as Error
        }
      }

      // Execute the registration handler without blocking
      logger.debug(
        `Firing request registration handler${
          cachedResponse ? ' (cached response already sent)' : ''
        }`,
      )

      requestRegistrationPromise = handler()
    }

    // Now that we have dealt with request registration, can return the cached response if present
    if (cachedResponse) {
      logger.debug('Found response from cache, sending that')
      return cachedResponse
    }

    // If there was no cached response, execute the foregroundExecute if defined
    const immediateResponse =
      transport.foregroundExecute && (await transport.foregroundExecute(req, this.config.settings))
    if (immediateResponse) {
      logger.debug('Got immediate response from transport, sending as response')
      return immediateResponse
    }

    // Finally, either because there was no synchronous execute or because it returned an empty response,
    // we wait for the cache to be filled (either from background work started in the sync execute, or the backgroundExecute).
    // We can wait for the request registration to have finished here, since we're going to be sleeping for the cache anyways,
    // and it's useful in case the registration throws a promise so that it doesn't go unhandled.
    await requestRegistrationPromise
    if (requestRegistrationError) {
      throw requestRegistrationError
    }

    // Observe the idle time taken for polling response
    const metricsTimer = metrics
      .get('transportPollingDurationSeconds')
      .labels({ adapter_endpoint: req.requestContext.endpointName })
      .startTimer()

    logger.debug('Transport is set up, polling cache for response...')
    const response = await pollResponseFromCache(
      this.dependencies.cache as Cache<AdapterResponse>,
      req.requestContext.cacheKey,
      {
        maxRetries: this.config.settings.CACHE_POLLING_MAX_RETRIES,
        sleep: this.config.settings.CACHE_POLLING_SLEEP_MS,
      },
    )

    metricsTimer({ succeeded: String(!!response) })

    if (response) {
      logger.debug('Got a response from polling the cache, sending that back')
      return response
    }

    // Record polling mechanism failure to return response
    metrics
      .get('transportPollingFailureCount')
      .labels({ adapter_endpoint: req.requestContext.endpointName })
      .inc()

    logger.debug('Ran out of polling attempts, returning timeout')
    throw new AdapterTimeoutError({
      message:
        'The EA has not received any values from the Data Provider for the requested data yet. Retry after a short delay, and if the problem persists raise this issue in the relevant channels.',
      statusCode: 504,
    })
  }
}
