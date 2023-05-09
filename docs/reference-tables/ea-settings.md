# EA Settings

|Name|Type|Default|&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Description&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;|&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;Validation&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;|Min|Max
|---|---|---|---|---|---|---|
|API_TIMEOUT|number|30000|The number of milliseconds a request can be pending before returning a timeout error for data provider request|- Value must be an integer<br> - Value must be above the minimum<br> - Value must be below the maximum|0|60000
|API_VERBOSE|boolean|false|Toggle whether the response from the EA should contain just the results or also include the full response body from the queried API.|||
|BACKGROUND_EXECUTE_MS_HTTP|number|1000|Time in milliseconds to sleep between HTTP transports' background execute calls, when there are no requests to send|- Value must be an integer<br> - Value must be above the minimum<br> - Value must be below the maximum|1|10000
|BACKGROUND_EXECUTE_MS_SSE|number|1000|Time in milliseconds to sleep between SSE transports' background execute calls|- Value must be an integer<br> - Value must be above the minimum<br> - Value must be below the maximum|1|10000
|BACKGROUND_EXECUTE_MS_WS|number|1000|Time in milliseconds to sleep between WS transports' background execute calls|- Value must be an integer<br> - Value must be above the minimum<br> - Value must be below the maximum|1|10000
|BACKGROUND_EXECUTE_TIMEOUT|number|90000|The maximum amount of time in milliseconds to wait for a background execute to finish|- Value must be an integer<br> - Value must be above the minimum<br> - Value must be below the maximum|1000|180000
|BASE_URL|string|/|Starting path for the EA handler endpoint|||
|CACHE_MAX_AGE|number|90000|Maximum amount of time (in ms) that a response will stay cached|- Value must be an integer<br> - Value must be above the minimum<br> - Value must be below the maximum|1000|1200000
|CACHE_MAX_ITEMS|number|10000|The maximum number of items that remain in the cache|- Value must be an integer<br> - Value must be above the minimum<br> - Value must be below the maximum|1000|10000
|CACHE_POLLING_MAX_RETRIES|number|10|Max amount of times to attempt to find EA response in the cache after the Transport has been set up|- Value must be an integer<br> - Value must be above the minimum<br> - Value must be below the maximum|0|20
|CACHE_POLLING_SLEEP_MS|number|200|The number of ms to sleep between each retry to fetch the EA response in the cache|- Value must be an integer<br> - Value must be above the minimum<br> - Value must be below the maximum|10|1000
|CACHE_REDIS_CONNECTION_TIMEOUT|number|15000|Connection timeout for redis client|- Value must be an integer<br> - Value must be above the minimum<br> - Value must be below the maximum|3000|60000
|CACHE_REDIS_HOST|string|127.0.0.1|Hostname for the Redis instance to be used|||
|CACHE_REDIS_MAX_RECONNECT_COOLDOWN|number|3000|Max cooldown (in ms) before attempting redis reconnection|- Value must be an integer<br> - Value must be above the minimum<br> - Value must be below the maximum|3000|10000
|CACHE_REDIS_PASSWORD|string|undefined|The password required for redis auth|||
|CACHE_REDIS_PATH|string|undefined|The UNIX socket string of the Redis server|||
|CACHE_REDIS_PORT|number|6379|Port for the Redis instance to be used|- Value must be an integer<br> - Value must be above the minimum<br> - Value must be below the maximum|1|65535
|CACHE_REDIS_TIMEOUT|number|500|Timeout to fail a Redis server request if no response (ms)|- Value must be an integer<br> - Value must be above the minimum<br> - Value must be below the maximum|500|10000
|CACHE_REDIS_URL|string|undefined|The URL of the Redis server. Format: [redis[s]:]//[[user][:password@]][host][:port][/db-number][?db=db-number[&password=bar[&option=value]]]|- Value must be a valid URL||
|CACHE_TYPE|enum|local|The type of cache to use throughout the EA|||
|CORRELATION_ID_ENABLED|boolean|true|Flag to enable correlation IDs for sent requests in logging|||
|DEBUG|boolean|false|Toggles debug mode|||
|DEFAULT_CACHE_KEY|string|DEFAULT_CACHE_KEY|Default key to be used when one cannot be determined from request parameters|||
|EA_HOST|string|::|Host this EA will listen for REST requests on (if mode is set to "reader" or "reader-writer")|- Value must be a valid IP address||
|EA_MODE|enum|reader-writer|Port this EA will listen for REST requests on (if mode is set to "reader" or "reader-writer")|||
|EA_PORT|number|8080|Port through which the EA will listen for REST requests (if mode is set to "reader" or "reader-writer")|- Value must be an integer<br> - Value must be above the minimum<br> - Value must be below the maximum|1|65535
|EXPERIMENTAL_METRICS_ENABLED|boolean|true|Flag to specify whether or not to collect metrics. Used as fallback for METRICS_ENABLED|||
|LOG_LEVEL|string|info|Minimum level required for logs to be output|||
|MAX_COMMON_KEY_SIZE|number|300|Maximum amount of characters that the common part of the cache key or feed ID can have|- Value must be an integer<br> - Value must be above the minimum<br> - Value must be below the maximum|150|500
|MAX_HTTP_REQUEST_QUEUE_LENGTH|number|200|The maximum amount of queued requests for Http transports before new ones push oldest ones out of the queue|- Value must be an integer<br> - Value must be above the minimum<br> - Value must be below the maximum|1|2000
|MAX_PAYLOAD_SIZE_LIMIT|number|1048576|Max payload size limit for the Fastify server|- Value must be an integer<br> - Value must be above the minimum<br> - Value must be below the maximum|1048576|1073741824
|METRICS_ENABLED|boolean|true|Flag to specify whether or not to startup the metrics server|||
|METRICS_PORT|number|9080|Port metrics will be exposed to|- Value must be an integer<br> - Value must be above the minimum<br> - Value must be below the maximum|1|65535
|METRICS_USE_BASE_URL|boolean|undefined|Flag to specify whether or not to prepend the BASE_URL to the metrics endpoint|||
|MTLS_ENABLED|boolean|false|Flag to specify whether mutual TLS/SSL is enabled or not|||
|RATE_LIMIT_API_TIER|string|undefined|Rate limiting tier to use from the available options for the adapter. If not present, the adapter will run using the first tier on the list.|||
|RATE_LIMIT_CAPACITY|number|undefined|Used as rate limit capacity per minute and ignores tier settings if defined|- Value must be an integer<br> - Value must be above the minimum|0|
|RATE_LIMIT_CAPACITY_MINUTE|number|undefined|Used as rate limit capacity per minute and ignores tier settings if defined. Supercedes RATE_LIMIT_CAPACITY if both vars are set|- Value must be an integer<br> - Value must be above the minimum|0|
|RATE_LIMIT_CAPACITY_SECOND|number|undefined|Used as rate limit capacity per second and ignores tier settings if defined|- Value must be an integer<br> - Value must be above the minimum|0|
|RATE_LIMITING_STRATEGY|enum|fixed-interval|The rate limiting strategy to use for outbound requests|||
|REQUESTER_SLEEP_BEFORE_REQUEUEING_MS|number|0|Time to sleep after a failed HTTP request before re-queueing the request (in ms)|- Value must be an integer<br> - Value must be above the minimum<br> - Value must be below the maximum|0|120000
|RETRY|number|1|Retry count for failed HTTP requests|- Value must be an integer<br> - Value must be above the minimum<br> - Value must be below the maximum|0|10
|SSE_KEEPALIVE_SLEEP|number|60000|Maximum amount of time (in ms) between each SSE keepalive request|- Value must be an integer<br> - Value must be above the minimum<br> - Value must be below the maximum|0|120000
|SSE_SUBSCRIPTION_TTL|number|300000|Maximum amount of time (in ms) an SSE subscription will be cached before being unsubscribed|- Value must be an integer<br> - Value must be above the minimum<br> - Value must be below the maximum|0|3600000
|SUBSCRIPTION_SET_MAX_ITEMS|number|10000|The maximum number of subscriptions set|- Value must be an integer<br> - Value must be above the minimum<br> - Value must be below the maximum|1000|10000
|TLS_CA|string|undefined|CA certificate to use for authenticating client certificates|||
|TLS_PASSPHRASE|string||Password to be used to generate an encryption key|||
|TLS_PRIVATE_KEY|string|undefined|Base64 Private Key of TSL/SSL certificate|- Value must be a valid base64 string||
|TLS_PUBLIC_KEY|string|undefined|Base64 Public Key of TSL/SSL certificate|- Value must be a valid base64 string||
|WARMUP_SUBSCRIPTION_TTL|number|300000|TTL for batch warmer subscriptions|- Value must be an integer<br> - Value must be above the minimum<br> - Value must be below the maximum|0|3600000
|WS_CONNECTION_OPEN_TIMEOUT|number|10000|The maximum amount of time in milliseconds to wait for the websocket connection to open (including custom open handler)|- Value must be an integer<br> - Value must be above the minimum<br> - Value must be below the maximum|500|30000
|WS_SUBSCRIPTION_TTL|number|120000|The time in ms a request will live in the subscription set before becoming stale|- Value must be an integer<br> - Value must be above the minimum<br> - Value must be below the maximum|0|3600000
|WS_SUBSCRIPTION_UNRESPONSIVE_TTL|number|120000|The maximum acceptable time (in milliseconds) since the last message was received and stored in the cache on a WebSocket connection before it is considered unresponsive, causing the adapter to close and attempt to reopen it.|- Value must be an integer<br> - Value must be above the minimum<br> - Value must be below the maximum|1000|180000

