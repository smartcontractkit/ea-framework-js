# Composite transport

Composite transport is a **framework feature** for multi-route endpoints: every registered child transport runs in parallel for the same endpoint, and successful cache writes are merged so only the “freshest” value wins. You enable it on the endpoint; you **do not** import or `new CompositeTransport(...)` in adapter code—that class is constructed internally when the conditions below are met.

Typical uses:

- Pair a low-latency stream (for example WebSocket) with a REST fallback so the cache still updates if the stream lags or drops.
- Run two data paths for the same feed and keep whichever provider reports a newer `providerIndicatedTimeUnixMs`.

## How to use it

1. Define the endpoint with **`transportRoutes`** (not a single `transport` field). Register **at least two** named child transports on a [`TransportRoutes`](../../../src/transports/index.ts) instance. Transport names must be lowercase letters only (see `TransportRoutes.register`).
2. Set **`enableCompositeTransport: true`** on the same [`AdapterEndpoint`](../../../src/adapter/endpoint.ts) params.
3. Turn the behavior on at runtime by setting adapter setting **`COMPOSITE_TRANSPORT`** to `true` (for example env `COMPOSITE_TRANSPORT=true`, or your adapter’s settings prefix).

If `enableCompositeTransport` is `true` but there are fewer than two routes, construction throws. If `enableCompositeTransport` is `true` but **`COMPOSITE_TRANSPORT`** is `false` (the default), the endpoint keeps **normal multi-transport routing** (`customRouter`, request `transport`, or `defaultTransport`) so operators can flip composite mode without redeploying.

When **both** flags are true, [`AdapterEndpoint.initialize`](../../../src/adapter/endpoint.ts) replaces the route map with a single internal route whose transport is a `CompositeTransport` built from your previous route entries. From then on the framework treats the endpoint as having one logical transport that fans out to all children.

## Example

```typescript
import { AdapterEndpoint } from '@chainlink/external-adapter-framework/adapter'
import { TransportRoutes } from '@chainlink/external-adapter-framework/transports'

// wsTransport and restTransport are normal transports you already defined
export const endpoint = new AdapterEndpoint({
  name: 'example',
  inputParameters,
  enableCompositeTransport: true,
  transportRoutes: new TransportRoutes<EndpointTypes>()
    .register('ws', wsTransport)
    .register('rest', restTransport),
})
```

Deploy or configure with **`COMPOSITE_TRANSPORT=true`** when you want parallel execution and merged caching for that endpoint.

## How it works (internals)

The framework’s `CompositeTransport` (see [`composite.ts`](../../../src/transports/composite.ts)) wires each child with a [`CompareResponseCache`](../../../src/cache/response-cache/compare.ts) instead of the raw endpoint cache: reads go through to the real cache, while writes are accepted only when the pending payload is newer than both the last value seen for that key on that child path and the value already stored, using **`timestamps.providerIndicatedTimeUnixMs`** (missing timestamps are treated as `0`). **`registerRequest`** and **`backgroundExecute`** are invoked on **every** child in parallel. There is no `foregroundExecute` on the composite itself; behavior comes entirely from the children.

Child names are the keys you passed to `register`; each child’s `initialize` receives that string as its `transportName`.

## Notes

- **Timestamps** — Children should populate `providerIndicatedTimeUnixMs` when they have a meaningful provider clock; otherwise merge order may not match business intent.
- **Concurrency** — Delivery order across children is not guaranteed; the merge rule is strictly “larger `providerIndicatedTimeUnixMs` wins.”
- **TTL** — TTL behavior flows through the compare cache with the composite’s transport name; see `CompareResponseCache.writeTTL` if you depend on per-transport TTL semantics.
- **Errors** — Children still own parsing and errors; the composite only arbitrates successful cache updates between children.
