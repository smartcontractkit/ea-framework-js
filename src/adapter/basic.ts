import Redis from 'ioredis'
import { Cache, CacheFactory, pollResponseFromCache } from '../cache'
import * as cacheMetrics from '../cache/metrics'
import {
  AdapterConfig,
  BaseAdapterConfig,
  BaseSettings,
  buildAdapterConfig,
  SettingsMap,
  validateAdapterConfig,
} from '../config'
import * as transportMetrics from '../transports/metrics'
import {
  buildRateLimitTiersFromConfig,
  FixedFrequencyRateLimiter,
  getRateLimitingTier,
  highestRateLimitTiers,
  SimpleCountingRateLimiter,
} from '../rate-limiting'
import { AdapterRequest, AdapterResponse, makeLogger, Merge, SubscriptionSetFactory } from '../util'
import CensorList, { CensorKeyValue } from '../util/censor/censor-list'
import { AdapterEndpoint } from './endpoint'
import {
  AdapterDependencies,
  AdapterParams,
  AdapterRateLimitingConfig,
  CustomAdapterSettings,
  EndpointGenerics,
  Overrides,
  RequestTransform,
} from './types'
import { AdapterTimeoutError } from '../validation/error'

const logger = makeLogger('Adapter')

/**
 * Main class to represent an External Adapter
 */
export class Adapter<CustomSettings extends CustomAdapterSettings = SettingsMap>
  implements Omit<AdapterParams<CustomSettings>, 'bootstrap'>
{
  // Adapter params
  name: Uppercase<string>
  defaultEndpoint?: string | undefined
  endpoints: AdapterEndpoint<Merge<EndpointGenerics, { CustomSettings: CustomSettings }>>[]
  envDefaultOverrides?: Partial<BaseAdapterConfig> | undefined
  customSettings?: SettingsMap | undefined
  rateLimiting?: AdapterRateLimitingConfig | undefined
  overrides?: Record<string, string> | undefined
  requestTransforms?: RequestTransform[]
  envVarsPrefix?: string

  // After initialization
  initialized = false

  /** Object containing alias translations for all endpoints */
  endpointsMap: Record<
    string,
    AdapterEndpoint<Merge<EndpointGenerics, { CustomSettings: CustomSettings }>>
  > = {}

  /** Initialized dependencies that the adapter will use */
  dependencies!: AdapterDependencies

  /** Configuration params for various adapter properties */
  config: AdapterConfig<CustomSettings>

  /** Bootstrap function that will run when initializing the adapter */
  private readonly bootstrap?: (adapter: Adapter<CustomSettings>) => Promise<void>

  constructor(params: AdapterParams<CustomSettings>) {
    // Copy over params
    this.name = params.name
    this.defaultEndpoint = params.defaultEndpoint?.toLowerCase()
    this.endpoints = params.endpoints
    this.envDefaultOverrides = params.envDefaultOverrides
    this.customSettings = params.customSettings
    this.rateLimiting = params.rateLimiting
    this.overrides = params.overrides
    this.requestTransforms = [this.symbolOverrider.bind(this), ...(params.requestTransforms || [])]
    this.bootstrap = params.bootstrap

    this.config = buildAdapterConfig({
      overrides: this.envDefaultOverrides,
      customSettings: this.customSettings,
      envVarsPrefix: this.envVarsPrefix,
    })

    this.normalizeEndpointNames()
    this.calculateRateLimitAllocations()
  }

  /**
   * Initializes all of the [[Transport]]s in the adapter, passing along any [[AdapterDependencies]] and [[AdapterConfig]].
   * Additionally, it builds a map out of all the endpoint names and aliases (checking for duplicates).
   */
  async initialize(dependencies?: Partial<AdapterDependencies>) {
    if (this.initialized) {
      throw new Error('This adapter has already been initialized!')
    }

    // Building configs during initialization to avoid validation errors during construction
    validateAdapterConfig(this.config, this.customSettings)

    // Log warnings for risks associated with certain configs and values
    this.logConfigWarnings()

    if (this.bootstrap) {
      await this.bootstrap(this)
    }

    this.dependencies = this.initializeDependencies(dependencies)

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
      await endpoint.initialize(this.dependencies, this.config)
    }

    // Build list of key/values that need to be redacted in logs
    // Populates the static array in CensorList to use in censor-transport
    this.buildCensorList()

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

    logger.debug('Adapter rate limit allocations:')
    for (const endpoint of this.endpoints) {
      if (!endpoint.rateLimiting) {
        endpoint.rateLimiting = {
          allocationPercentage:
            implicitAllocation / (numberOfEndpoints - endpointsWithExplicitAllocations.length),
        }
      }

      logger.debug(`Endpoint [${endpoint.name}] - ${endpoint.rateLimiting?.allocationPercentage}%`)
    }
  }

  /**
   * Creates a list of key/value pairs that need to be censored in the logs
   * using the sensitive flag in the adapter config
   */
  private buildCensorList() {
    const censorList: CensorKeyValue[] = Object.entries(BaseSettings as SettingsMap)
      .concat(Object.entries((this.customSettings as SettingsMap) || {}))
      .filter(
        ([name, setting]) =>
          setting &&
          setting.type === 'string' &&
          setting.sensitive &&
          this.config[name as keyof AdapterConfig<CustomSettings>],
      )
      .map(([name]) => ({
        key: name,
        // Escaping potential special characters in values before creating regex
        value: new RegExp(
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          ((this.config as AdapterConfig)[name]! as string).replace(
            /[-[\]{}()*+?.,\\^$|#\s]/g,
            '\\$&',
          ),
          'gi',
        ),
      }))
    CensorList.set(censorList)
  }

  /**
   * Logs a warning for certain configs if set to particular values.
   * Used to warn stakeholders of potential risks.
   */
  private logConfigWarnings() {
    if (
      this.config.LOG_LEVEL.toUpperCase() === 'DEBUG' ||
      this.config.LOG_LEVEL.toUpperCase() === 'TRACE'
    ) {
      logger.warn(
        `LOG_LEVEL has been set to ${this.config.LOG_LEVEL.toUpperCase()}. Setting higher log levels results in increased memory usage and potentially slower performance.`,
      )
    }
    if (this.config.DEBUG === true) {
      logger.warn(`The adapter is running with DEBUG mode on.`)
    }
    if (this.config.METRICS_ENABLED === false) {
      logger.warn(
        `METRICS_ENABLED has been set to false. Metrics should not be disabled in a production environment.`,
      )
    }
    if (this.config.MAX_PAYLOAD_SIZE_LIMIT !== BaseSettings.MAX_PAYLOAD_SIZE_LIMIT.default) {
      logger.warn(
        `MAX_PAYLOAD_SIZE_LIMIT has been set to ${this.config.MAX_PAYLOAD_SIZE_LIMIT}. This setting should only be set when absolutely necessary.`,
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

    if (!dependencies.redisClient) {
      if (this.config.CACHE_TYPE === 'redis') {
        const maxCooldown = this.config.CACHE_REDIS_MAX_RECONNECT_COOLDOWN
        const redisOptions = {
          enableAutoPipelining: true, // This will make multiple commands be batch automatically
          host: this.config.CACHE_REDIS_HOST,
          port: this.config.CACHE_REDIS_PORT,
          password: this.config.CACHE_REDIS_PASSWORD,
          path: this.config.CACHE_REDIS_PATH, // If set, port and host are ignored
          timeout: this.config.CACHE_REDIS_TIMEOUT,
          retryStrategy(times: number): number {
            cacheMetrics.redisRetriesCount.inc()
            logger.warn(`Redis reconnect attempt #${times}`)
            return Math.min(times * 100, maxCooldown) // Next reconnect attempt time
          },
          connectTimeout: this.config.CACHE_REDIS_CONNECTION_TIMEOUT,
          maxRetriesPerRequest: 30, // Limits the number of retries before the adapter shuts down
        }
        if (this.config.CACHE_REDIS_URL) {
          dependencies.redisClient = new Redis(this.config.CACHE_REDIS_URL, redisOptions)
        } else {
          dependencies.redisClient = new Redis(redisOptions)
        }

        dependencies.redisClient.on('connect', () => {
          cacheMetrics.redisConnectionsOpen.inc()
        })
      }
    }

    if (!dependencies.cache) {
      dependencies.cache = CacheFactory.buildCache(
        { cacheType: this.config.CACHE_TYPE, maxSizeForLocalCache: this.config.CACHE_MAX_ITEMS },
        dependencies.redisClient,
      )
    }

    const rateLimitingTier = getRateLimitingTier(
      this.config as AdapterConfig,
      this.rateLimiting?.tiers,
    )

    const highestTierValue = highestRateLimitTiers(this.rateLimiting?.tiers)
    const rateLimitTierFromConfig = buildRateLimitTiersFromConfig(this.config as AdapterConfig)
    const perSecRateLimit = rateLimitTierFromConfig?.rateLimit1s || 0
    const perMinuteRateLimit = (rateLimitTierFromConfig?.rateLimit1m || 0) * 60

    if (perSecRateLimit > highestTierValue) {
      logger.warn(
        `The configured RATE_LIMIT_CAPACITY_SECOND value is higher than the highest tier value from limits.json ${highestTierValue}`,
      )
    }

    if (perMinuteRateLimit > highestTierValue) {
      logger.warn(`The configured ${
        this.config.RATE_LIMIT_CAPACITY_MINUTE
          ? 'RATE_LIMIT_CAPACITY_MINUTE'
          : 'RATE_LIMIT_CAPACITY'
      }
      value is higher than the highest tier value from limits.json ${highestTierValue}`)
    }

    if (!dependencies.requestRateLimiter) {
      dependencies.requestRateLimiter = new SimpleCountingRateLimiter().initialize(
        this.endpoints,
        rateLimitingTier,
      )
    }
    if (!dependencies.backgroundExecuteRateLimiter) {
      dependencies.backgroundExecuteRateLimiter = new FixedFrequencyRateLimiter().initialize(
        this.endpoints,
        rateLimitingTier,
      )
    }
    if (!dependencies.subscriptionSetFactory) {
      dependencies.subscriptionSetFactory = new SubscriptionSetFactory(
        this.config as AdapterConfig,
        this.name,
        dependencies.redisClient,
      )
    }

    return dependencies as AdapterDependencies
  }

  /**
   * Attempts to find a value from the Cache and return that if found.
   *
   * @param req - the incoming request to this adapter
   * @returns the cached value if exists
   */
  async findResponseInCache(req: AdapterRequest): Promise<AdapterResponse | undefined> {
    const response = await (this.dependencies.cache as Cache<AdapterResponse>).get(
      req.requestContext.cacheKey,
    )

    if (response) {
      if (this.config.METRICS_ENABLED && this.config.EXPERIMENTAL_METRICS_ENABLED) {
        const label = cacheMetrics.cacheMetricsLabel(
          req.requestContext.cacheKey,
          req.requestContext.meta?.metrics?.feedId || 'N/A',
          this.config.CACHE_TYPE,
        )

        // Record cache staleness and cache get count and value
        const now = Date.now()
        cacheMetrics.cacheGet(label, response.result, {
          cache: now - response.timestamps.providerDataReceived,
          total: response.timestamps.providerIndicatedTime
            ? now - response.timestamps.providerIndicatedTime
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
   * Default request transform that takes requests and manipulates
   *
   * @param adapter - the current adapter
   * @param req - the current adapter request
   * @returns the modified (or new) request
   */
  symbolOverrider(req: AdapterRequest) {
    const rawRequestBody = req.body as { data?: { overrides?: Overrides } }
    const requestOverrides = rawRequestBody.data?.overrides?.[this.name.toLowerCase()]
    const base = req.requestContext.data['base'] as string

    if (requestOverrides?.[base]) {
      // Perform overrides specified in the request payload
      req.requestContext.data['base'] = requestOverrides[base]
    } else if (this.overrides?.[base]) {
      // Perform hardcoded adapter overrides
      req.requestContext.data['base'] = this.overrides[base]
    }

    return req
  }

  /**
   * Takes the incoming request and applies all request transforms in the adapter
   *
   * @param req - the current adapter request
   * @returns the request after passing through all request transforms
   */
  runRequestTransforms(req: AdapterRequest): void {
    if (!this.requestTransforms) {
      return
    }

    for (const transform of this.requestTransforms) {
      transform(req)
    }
  }

  /**
   * Function to serve as middleware to pass along the AdapterRequest to the appropriate Transport (acc. to the endpoint in the req.)
   *
   * @param req - the incoming request to this adapter
   * @param replySent - a promise that resolves when the reply has already been sent
   * @returns a simple Promise when it's done
   */
  async handleRequest(req: AdapterRequest, replySent: Promise<unknown>): Promise<AdapterResponse> {
    // Get transport, must be here because it's already checked in the validator
    const transport = this.endpointsMap[req.requestContext.endpointName].transport

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
          return await transport.registerRequest!(req, this.config)
        } catch (err) {
          logger.error(`Error registering request: ${err}`)
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
      transport.foregroundExecute && (await transport.foregroundExecute(req, this.config))
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
    const metricsTimer = transportMetrics.transportPollingDurationSeconds
      .labels({ endpoint: req.requestContext.endpointName })
      .startTimer()

    logger.debug('Transport is set up, polling cache for response...')
    const response = await pollResponseFromCache(
      this.dependencies.cache as Cache<AdapterResponse>,
      req.requestContext.cacheKey,
      {
        maxRetries: this.config.CACHE_POLLING_MAX_RETRIES,
        sleep: this.config.CACHE_POLLING_SLEEP_MS,
      },
    )

    metricsTimer({ succeeded: String(!!response) })

    if (response) {
      logger.debug('Got a response from polling the cache, sending that back')
      return response
    }

    // Record polling mechanism failure to return response
    transportMetrics.transportPollingFailureCount
      .labels({ endpoint: req.requestContext.endpointName })
      .inc()

    logger.debug('Ran out of polling attempts, returning timeout')
    throw new AdapterTimeoutError({
      message:
        'The EA has not received any values from the Data Provider for the requested data yet. Retry after a short delay, and if the problem persists raise this issue in the relevant channels.',
      statusCode: 504,
    })
  }
}
