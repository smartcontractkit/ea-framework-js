# Streaming Transport

The `StreamingTransport` is an **abstract transport** (class) that extends the [SubscriptionTransport](./subscription-transport.md) and provides a foundation for implementing streaming-based transports. It handles incoming requests, manages subscriptions, and defines an abstract `streamHandler` method to process subscription deltas. This class is intended to be extended by specific transport implementations.

All incoming requests to the adapter for an endpoint that uses stream-based transport are stored in a cached set (`SubscriptionSet`). Periodically, the background execute loop of the adapter will read the entire subscription set and call the `backgroundHandler` method of the transport.`backgroundHandler` method is already implemented in `StreamingTransport`. It calculates subscription deltas (new subscriptions and subscriptions to unsubscribe) based on the all subscriptions and the current local subscriptions. The deltas are then passed to the `streamHandler` method for further processing.


When extending `StreamingTransport` there are two abstract methods that should be implemented by subclasses. 
1. `streamHandler`  receives endpoint context as first argument and object containing details for the desired, new, and stale subscriptions as second argument and is responsible for handling the streaming connection, sending messages to the streaming source, and processing subscription deltas.
2. `getSubscriptionTtlFromConfig` is an abstract method from `SubscriptionTransport`. It receives adapter settings and should return time-to-live (TTL) value for subscription set.


An example of `StreamingTransport` is built-in [Websocket Transport](./websocket-transport.md) and [SSE Transport](./sse-transport.md)