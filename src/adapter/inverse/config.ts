import { AdapterInputError } from '../../validation/error'

/** Reserved request parameter that enables inversion. */
export const INVERSION_PARAM = 'inversion'

/** Config accepted from the request/jobspec. */
export type InversionRequestConfig = {
  enabled: boolean
}

/** Inversion config before policy metadata is trusted. */
export type RawInversionConfig = InversionRequestConfig & {
  policyId?: unknown
  policyVersion?: unknown
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const validateInversionRequestConfig = (config: unknown): InversionRequestConfig => {
  if (!isRecord(config)) {
    throw new AdapterInputError({
      statusCode: 400,
      message: `[Param: ${INVERSION_PARAM}] must be an object`,
    })
  }

  const unknownKeys = Object.keys(config).filter((key) => key !== 'enabled')
  if (unknownKeys.length) {
    throw new AdapterInputError({
      statusCode: 400,
      message: `[Param: ${INVERSION_PARAM}] contains unsupported keys: ${unknownKeys.join(', ')}`,
    })
  }

  if (typeof config['enabled'] !== 'boolean') {
    throw new AdapterInputError({
      statusCode: 400,
      message: `[Param: ${INVERSION_PARAM}.enabled] must be a boolean`,
    })
  }

  return { enabled: config['enabled'] as boolean }
}

/**
 * Read inversion config from params. Checks the property first so Proxy-based
 * test doubles that throw on unknown access stay safe.
 */
export const getRawInversionConfig = (params: unknown): RawInversionConfig | undefined => {
  if (!isRecord(params)) {
    return undefined
  }
  if (!Object.prototype.hasOwnProperty.call(params, INVERSION_PARAM)) {
    return undefined
  }
  const config = params[INVERSION_PARAM]
  if (!isRecord(config) || typeof config['enabled'] !== 'boolean') {
    return undefined
  }
  return {
    enabled: config['enabled'],
    policyId: config['policyId'],
    policyVersion: config['policyVersion'],
  }
}

/** Whether params explicitly enable inversion. */
export const hasInversionEnabled = (params: unknown): boolean =>
  getRawInversionConfig(params)?.enabled === true

/** Remove the framework-only inversion config before provider calls. */
export const stripInversionConfig = <T extends Record<string, unknown>>(params: T): T => {
  if (!Object.prototype.hasOwnProperty.call(params, INVERSION_PARAM)) {
    return params
  }
  const copy = { ...params }
  delete copy[INVERSION_PARAM]
  return copy
}
