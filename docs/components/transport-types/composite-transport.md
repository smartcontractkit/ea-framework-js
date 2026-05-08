# Composite transport

`CompositeTransport` runs several child transports in parallel for the same endpoint and merges their writes into a single response cache. You choose when a newer value from any child should replace what is already cached by implementing `shouldUpdate`.

Typical uses:

- Combine a low-latency channel (for example WebSocket) with a REST fallback so the cache still updates if the stream lags or drops.
- Prefer one provider’s quote over another’s when both are active, using freshness, spread, or custom rules in `shouldUpdate`.

## How it works

1. **Initialization** — Each child transport is initialized with the same adapter dependencies, except `responseCache` is replaced by a `[CompareResponseCache](../../../src/cache/response-cache/compare.ts)` wrapper. That wrapper forwards reads to the real endpoint cache but filters writes: a write is applied only when `shouldUpdate(next, current)` is true for the pending value versus the last locally seen value for that cache key, and again versus the value already in the shared cache (so concurrent children do not blindly overwrite each other).
2. **Subscriptions** — `registerRequest` is invoked on every child in parallel, so each transport can register the request in its own subscription set or equivalent.
3. **Background execution** — `backgroundExecute` is invoked on every child in parallel. All children share the same merged cache policy via `shouldUpdate`.

Child transport names come from the keys of the `transports` object you pass in (for example `ws` and `rest`). Those names are passed to each child’s `initialize` as its `transportName`.

## Configuration

`CompositeTransport` is constructed with a `CompositeTransportConfig`:

| Field          | Description                                                                                                                                                       |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `transports`   | Record of named child `Transport` instances. All children must use the same `TransportGenerics` as the composite.                                                 |
| `shouldUpdate` | `(next, current?) => boolean`. Return `true` if `next` should replace `current` in the cache. `current` is `undefined` when there is no prior value for that key. |

The composite implements `Transport` but does not define `foregroundExecute`; behavior depends entirely on the children.

## Example

Two HTTP-style transports (here standing in for WS vs REST) both poll the same symbols. The cache keeps whichever result has the higher `result` field:

```typescript
import { CompositeTransport, HttpTransport } from '@chainlink/external-adapter-framework/transports'

const ws = new HttpTransport<EndpointTypes>({
  /* ... */
})
const rest = new HttpTransport<EndpointTypes>({
  /* ... */
})

const transport = new CompositeTransport<EndpointTypes>({
  transports: { ws, rest },
  shouldUpdate: (next, current) => (next?.result ?? 0) > (current?.result ?? 0),
})
```

Use the composite as the endpoint’s single `transport` in `AdapterEndpoint` (see `[test/transports/composite.test.ts](../../../test/transports/composite.test.ts)` for a full adapter-level example).

## Notes

- **Ordering** — Children run concurrently; which response arrives first is not guaranteed. `shouldUpdate` should encode your merge policy (for example “newer timestamp wins” or “always prefer stream unless stale”).
- **TTL** — TTL writes are forwarded to the underlying cache with the composite’s transport name; see `CompareResponseCache.writeTTL` if you rely on per-transport TTL behavior.
- **Errors** — Child transports still own parsing and error handling; the composite only decides whether successful cache entries from a child replace existing ones.
