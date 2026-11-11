import { AdapterInputError } from '../../validation/error'

/** Reserved request parameter that enables inversion. */
export const INVERSION_PARAM = 'inversion'

/** Config accepted from the request/jobspec. */
export type InversionRequestConfig = {
  enabled: boolean
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
export const getInversionConfig = (params: unknown): InversionRequestConfig | undefined => {
  if (!isRecord(params) || !Object.prototype.hasOwnProperty.call(params, INVERSION_PARAM)) {
    return undefined
  }
  const config = params[INVERSION_PARAM]
  return isRecord(config) && typeof config['enabled'] === 'boolean'
    ? { enabled: config['enabled'] }
    : undefined
}

/** Whether params explicitly enable inversion. */
export const hasInversionEnabled = (params: unknown): boolean =>
  getInversionConfig(params)?.enabled === true

/** Remove the request-only inversion param before provider calls and grouping. */
export const toProviderParams = <T extends Record<string, unknown>>(params: T): T => {
  if (!Object.prototype.hasOwnProperty.call(params, INVERSION_PARAM)) {
    return params
  }
  const copy = { ...params }
  delete copy[INVERSION_PARAM]
  return copy
}
