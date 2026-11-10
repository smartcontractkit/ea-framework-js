# Adapter

The adapter is initialized in the root-level `index.ts` file. It is configured using parameters set by the developer of the particular EA. These parameters are described in the sections below.

For EA's specific to retrieving price data, the framework provides a `PriceAdapter` class that standardizes types and has the added `includes` feature (covered [here](#includes)). The `PriceAdapter` class requires that at least one of the endpoints is a `PriceEndpoint` (covered in the [Endpoints Guide](./endpoints.md)).

## Default Endpoint

The default endpoint parameter is a string set to the name of one of the adapter endpoints. Requests will direct to this endpoint if the `endpoint` input parameter is not specified. The adapter will NOT fallback to this default if an incorrect endpoint name is explicitly defined in the request.

## Custom Settings

The v3 framework allows developers to define env vars that are specific to their EA. They should be defined in the `/config/index.ts` file in the format below.

If the EA does not require any custom env vars, this file can be ignored. Instead using the type `SettingsMap` from `@chainlink/external-adapter-framework/config`, where applicable, would be sufficient.

```typescript
import { AdapterConfig } from '@chainlink/external-adapter-framework/config'

export const config = new AdapterConfig({
  API_KEY: {
    description: '', // Description of the env var
    type: 'string', // What type should the value be
    options: ['foo', 'bar'], // If applicable, a list of valid options this env var could be set to
    default: 'foo', // If applicable, a default value
    validate: {
      meta: {},
      fn: () => {},
    }, // If applicable, a Validator object to validate the env var value. Return an error message for a failed validation, or undefined if it passes.
    required: true, // If the env var should be required. Default = false
    sensitive: false, // Set to false if the env var is safe to show uncensored in logs or telemetry. Default = true
  },
})
```

## Env Var Default Overrides

**Only use if absolutely necessary**

The adapter allows framework level env var defaults to be overriden. Framework level env vars have reasonable defaults already set so this parameter should not be needed for most adapters. Also, it should not be used to override defaults for custom settings since those should be specified directly in the custom settings object.

## Rate Limiting Tiers

Data provider specific rate limit tiers can be specified as one of the adapter parameters. They are defined by seconds, minutes, and/or hours. The tiers would then be selected using the `RATE_LIMIT_API_TIER` env var by setting it to the name of the tier.

## Overrides

Overrides are defined in the `/config/overrides.json` file. They allow input parameters to be overriden from a generic symbol to something more specific for the data provider such as an ID. An example of the format is below.

```json
{
  "adapterName": {
    "ETH": "1234"
  }
}
```

To understand where the overrides are applied, please refer to the [Request Validation & Transformation Diagram](#request-validation--transformation)

## Includes

The includes list, defined in the `/config/includes.json` file, is a parameter only for the `PriceAdapter`. In the v3 framework's current implementation, it is only used for inverses. This feature allows data to be retrieved for the inverse of pairs that a data provider does not support.

The most common example of this is for foreign exchange rates. Some data providers will only support pairs in one direction such as USD/JPY but not JPY/USD. To provide data for both directions, we can add an entry for this pair in the includes list like below. This will allow the adapter to retrieve data for USD/JPY instead and return (1 / result) when the request is for JPY/USD.

```json
[
  {
    "from": "JPY",
    "to": "USD",
    "includes": [
      {
        "from": "USD",
        "to": "JPY",
        "inverse": true
      }
    ]
  }
]
```

To understand where the inverses are applied, please refer to the [Request Validation & Transformation Diagram](#request-validation--transformation)

## Request-driven inversion

New feeds can request the inverse of a provider-supported pair without adding an entry to `includes.json`. Inversion is opt-in per request and is applied on the cache-write path:

```json
{
  "endpoint": "forex",
  "data": {
    "base": "USD",
    "quote": "JPY",
    "inversion": {
      "enabled": true
    }
  }
}
```

The request only enables inversion. The endpoint policy owns the fields and validity rules:

| Endpoint                       | Fields inverted                                                | Notes                                                                          |
| ------------------------------ | -------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `PriceEndpoint` / single-value | `data.result` → `1 / data.result`; top-level `result` mirrored | `data.result` is the canonical value                                           |
| `LwbaEndpoint` / quote         | `bid' = 1 / ask`, `ask' = 1 / bid`                             | `mid'` uses the provider mid when present; otherwise `(1 / ask + 1 / bid) / 2` |

For LWBA responses, optional `bidSize`/`askSize` values are swapped when present. Size validity and null handling remain owned by the asset-class policy (OPDATA-9200).

Inversion is atomic per response: all fields are validated and inverted together. A missing or invalid `bid`/`ask` makes the whole response 502; a missing or null `mid` is synthesized from the inverted bid/ask midpoint. No partial fields are written. Provider error responses are never inverted.

`resultValidator` runs after cache-write inversion and must accept the inverted values; a thrown validator fails the cache write. The raw `LwbaEndpoint` validator still requires a provider `mid`, so an inverse request can accept a payload that the raw feed rejects. Unifying that quote schema remains part of OPDATA-9200.

### Cache keys and feed IDs

- Requests without `inversion`, and requests with `inversion: { "enabled": false }`, keep the existing cache key, feed ID, and `includes.json` behavior.
- `inversion: null` is rejected; omit the parameter to disable inversion.
- Enabled requests include the resolved policy id/version in request params, so raw and inverse variants use distinct cache keys and feed IDs.
- Endpoints with a custom `cacheKeyGenerator` reject enabled inversion with a 400 until the generator is supported on the write path.
- If a generated key or feed ID exceeds `MAX_COMMON_KEY_SIZE`, it is SHA-1 hashed, not truncated.
- A policy version bump changes the inverse cache key and feed ID and uses a separate inversion subscription set. Coordinate that migration across all readers and writers.

### Metrics

`inversionTotal{adapter_endpoint, policy, status}` counts provider results. `applied` means the policy transform succeeded; `rejected` means it returned a 502. A later `resultValidator` rejection still counts as `applied`, and composite endpoints count once per child transport result.

### Transports and rollout

- Background transports strip inversion config before provider requests and subscriptions. Raw and inverse variants share one provider subscription.
- Built-in HTTP, WS, and SSE transports support inversion. Custom background transports must set `supportsInversion = true` and either extend `SubscriptionTransport` (which registers its variant resolver on the response cache) or implement equivalent fan-out; otherwise inversion requests are rejected with a 400.
- `foregroundExecute` implementations must return the raw provider response and must not forward `inversion` to the provider. The framework applies inversion to the immediate response; pre-inverted values would be inverted twice.
- If both `includes.json` and an enabled explicit `inversion` config apply, the inversions compose. Explicit inversion inverts the final requested pair, so an includes-inverse feed changes direction rather than returning the same value.
- Unmatched provider-result variants are logged once per key; the inverse cache entry is not written.
- Inversion subscriptions are stored in a policy-versioned subscription set. Pre-inversion pods only read the legacy set, so they do not consume inversion entries.
- The framework cannot enforce EA-version support. Upgrade all writers first, then readers, wait for the legacy subscription set to drain, and only then enable inversion. A policy version bump requires a fresh drain. Do not add inversion to existing feeds; it creates a new feed identity.
- `inversion` is a reserved request parameter. Audit adapters, input-param aliases, and jobspecs before upgrading; it cannot be used as an existing input field.
- Raw and inverse feeds double cache and subscription-set cardinality. For local caches, `SUBSCRIPTION_SET_MAX_ITEMS` applies per subscription set; Redis subscription sets are unbounded, so monitor Redis memory and keyspace. `CACHE_MAX_ITEMS` covers the Redis local read cache and is consumed by both variants.
- Inversion-capable endpoints read both the legacy and policy-versioned subscription sets each background cycle. Plan Redis command capacity for the extra reads.

## Request Transforms

**Only use if absolutely necessary**

Request transforms is an array of functions that allow the transformation of input parameters. The functions are provided with the incoming `AdapterRequest` object that can be altered and passed on to either another function or the rest of the adapter's logic.

Below is an example of a request transform function that uses the incoming request and transforms it by replacing `base` and `quote` with a new `hash` field.

Note: This component should not be used for overrides and inverses.

```typescript
export const requestTransform = (
  req: AdapterRequest<TypeFromDefinition<typeof inputParameters.definition>>,
): void => {
  const base = req.requestContext.data.base
  const quote = req.requestContext.data.quote
  if (base && quote) {
    req.requestContext.data.hash = hash(`${base}${quote}`)
    delete req.requestContext.data.base
    delete req.requestContext.data.quote
  }
}
```

To understand where these transformation apply, please refer to the [Request Validation & Transformation Diagram](#request-validation--transformation)

## Bootstrap Function

**Only use if absolutely necessary**

The bootstrap function is custom logic a developer can specify to run at the startup of the adapter.

One use case, shown below, is to perform validations on combinations of env vars. An error is thrown on failure to halt the adapter startup.

```typescript
export const adapter = new Adapter({
  ...
  bootstrap: async (adapter: Adapter<typeof customSettings>) => {
    if (adapter.config.WS_ENABLED && !adapter.config.WS_API_KEY) {
      throw 'WS_API_KEY is required when WS_ENABLED is set to true'
    }
  },
  ...
})
```

## Request Validation & Transformation

This diagram expands on the `Validation Middleware` section of the `EA v3 Design` diagram in [Basics](../basics.md#ea-v3-design)

```mermaid
flowchart TD
    R((Incoming \nRequest))
    R --> A
    subgraph Validation Middleware
        A["Default Input Validations"] --> B
        B["Custom Input Validations"] --> RC
        RC[Request.requestContext Generation] --> C
        subgraph "Request Transforms (sequential)"
            C["Symbol Overrides Transformations \n (default)"] -.-> D
            D["Custom Request Transforms"] -.-> E
        end
        E["Includes Inverse Transformation \n (in PriceAdapters)"] --> F
        F[Cache Key Generation]
    end
```
