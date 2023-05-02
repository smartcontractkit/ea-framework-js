# Metrics

|Name|Type|Help|Label Names|
|---|---|---|---|
|bgExecuteDurationSeconds|Gauge|A histogram bucket of the distribution of background execute durations|adapter_endpoint,transport|
|bgExecuteErrors|Counter|The number of background execute errors per endpoint x transport|adapter_endpoint,transport|
|bgExecuteSubscriptionSetCount|Gauge|The number of active subscriptions in background execute|adapter_endpoint,transport_type,transport|
|bgExecuteTotal|Counter|The number of background executes performed per endpoint|adapter_endpoint,transport|
|cacheDataGetCount|Counter|A counter that increments every time a value is fetched from the cache|feed_id,participant_id,cache_type|
|cacheDataGetValues|Gauge|A gauge keeping track of values being fetched from cache|feed_id,participant_id,cache_type|
|cacheDataMaxAge|Gauge|A gauge tracking the max age of stored values in the cache|feed_id,participant_id,cache_type|
|cacheDataSetCount|Counter|A counter that increments every time a value is set to the cache|feed_id,participant_id,cache_type,status_code|
|cacheDataStalenessSeconds|Gauge|Observes the cache staleness of the data returned (i.e., time since the data was written to the cache)|feed_id,participant_id,cache_type|
|cacheWarmerCount|Gauge|The number of cache warmers running|isBatched|
|dataProviderRequestDurationSeconds|Histogram|A histogram bucket of the distribution of data provider request durations||
|dataProviderRequests|Counter|The number of http requests that are made to a data provider|method,provider_status_code|
|httpRequestDurationSeconds|Histogram|A histogram bucket of the distribution of http request durations||
|httpRequestsTotal|Counter|The number of http requests this external adapter has serviced for its entire uptime|method,status_code,retry,type,feed_id,provider_status_code|
|providerTimeDelta|Gauge|Measures the difference between the time indicated by a DP for a value vs the time it was written to cache|feed_id|
|rateLimitCreditsSpentTotal|Counter|The number of data provider credits the adapter is consuming|participant_id,feed_id|
|redisCommandsSentCount|Counter|The number of redis commands sent|status,function_name|
|redisConnectionsOpen|Counter|The number of redis connections that are open||
|redisRetriesCount|Counter|The number of retries that have been made to establish a redis connection||
|requesterQueueOverflow|Counter|Total times the requester queue replaced the oldest item to avoid an overflow||
|requesterQueueSize|Gauge|The number of provider http requests currently queued to be executed||
|totalDataStalenessSeconds|Gauge|Observes the total staleness of the data returned (i.e., time since the provider indicated the data was sent)|feed_id,participant_id,cache_type|
|transportPollingDurationSeconds|Gauge|A histogram bucket of the distribution of transport polling idle time durations|adapter_endpoint,succeeded|
|transportPollingFailureCount|Counter|The number of times the polling mechanism ran out of attempts and failed to return a response|adapter_endpoint|
|wsConnectionActive|Gauge|The number of active connections||
|wsConnectionClosures|Counter|The number of connection closures|url,code|
|wsConnectionErrors|Counter|The number of connection errors|message|
|wsMessageTotal|Counter|The number of messages sent in total|feed_id,subscription_key,direction|
|wsSubscriptionActive|Gauge|The number of currently active subscriptions|feed_id,subscription_key|
|wsSubscriptionTotal|Counter|The number of subscriptions opened in total|feed_id,subscription_key|

