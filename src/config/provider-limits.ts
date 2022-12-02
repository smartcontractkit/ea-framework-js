import { makeLogger } from '../util'

export const DEFAULT_MINUTE_RATE_LIMIT = 60
export const BURST_UNDEFINED_QUOTA_MULTIPLE = 2

export const DEFAULT_WS_CONNECTIONS = 2
export const DEFAULT_WS_SUBSCRIPTIONS = 10

type RateLimitTimeFrame = 'rateLimit1s' | 'rateLimit1m' | 'rateLimit1h'

type HTTPTier = {
  rateLimit1s?: number
  rateLimit1m?: number
  rateLimit1h?: number
  note?: string
}

type WSTier = {
  connections: number
  subscriptions: number
}

export interface Limits {
  http: Record<string, HTTPTier>
  ws: Record<string, WSTier>
}

interface ProviderRateLimit {
  second: number
  minute: number
}

const logger = makeLogger('ProviderLimits')

export const getHTTPLimit = (
  provider: string,
  limits: Limits,
  tier: string,
  timeframe: RateLimitTimeFrame,
): number => {
  const providerLimit = getProviderLimits(provider, limits, tier, 'http')
  return (providerLimit as HTTPTier)?.[timeframe] || 0
}

export const getRateLimit = (provider: string, limits: Limits, tier: string): ProviderRateLimit => {
  const providerLimit = getProviderLimits(provider, limits, tier, 'http')
  return calculateRateLimit(providerLimit as HTTPTier)
}

export const getWSLimits = (provider: string, limits: Limits, tier: string): WSTier => {
  const providerLimit = getProviderLimits(provider, limits, tier, 'ws')
  return calculateWSLimits(providerLimit as WSTier)
}

const getProviderLimits = (
  provider: string,
  limits: Limits,
  tier: string,
  protocol: 'ws' | 'http',
): HTTPTier | WSTier | undefined => {
  const providerConfig = parseLimits(limits)
  if (!providerConfig) {
    throw new Error(
      `Rate Limit: Provider: "${provider}" doesn't match any provider spec in limits.json`,
    )
  }

  const protocolConfig = providerConfig[protocol]
  if (!protocolConfig) {
    throw new Error(
      `Rate Limit: "${provider}" doesn't have any configuration for ${protocol} in limits.json`,
    )
  }

  let limitsConfig = protocolConfig[tier.toLowerCase()]

  if (!limitsConfig) {
    logger.debug(
      `Rate Limit: "${provider} does not have tier ${tier} defined. Falling back to lowest tier"`,
    )
    limitsConfig = Object.values(protocolConfig)?.[0]
  }

  if (!limitsConfig) {
    throw new Error(
      `Rate Limit: Provider: "${provider}" has no tiers defined for ${protocol} in limits.json`,
    )
  }

  return limitsConfig
}

const objectKeysToLowercase = <T>(obj: Record<string, T>): Record<string, T> => {
  const lower: Record<string, T> = {}

  for (const key in obj) {
    lower[key.toLowerCase()] = obj[key]
  }

  return lower
}

const parseLimits = (limits: Limits): Limits => {
  limits.http = objectKeysToLowercase(limits.http)
  limits.ws = objectKeysToLowercase(limits.ws)
  return limits
}

const calculateWSLimits = (providerLimit: WSTier): WSTier => {
  return {
    connections: providerLimit.connections,
    subscriptions: providerLimit.subscriptions,
  }
}

const calculateRateLimit = (providerLimit: HTTPTier): ProviderRateLimit => {
  let quota = providerLimit.rateLimit1m
  if (!quota && providerLimit?.rateLimit1h) {
    quota = providerLimit?.rateLimit1h / 60
  } else if (!quota && providerLimit?.rateLimit1s) {
    quota = providerLimit?.rateLimit1s * 60
  }
  return {
    second: providerLimit?.rateLimit1s || ((quota as number) / 60) * BURST_UNDEFINED_QUOTA_MULTIPLE,
    minute: quota as number,
  }
}
