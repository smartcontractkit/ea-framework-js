import Ajv from 'ajv'
import fs from 'fs'
import path from 'path'
import { makeLogger } from './logger'
import { AdapterRequestData } from './types'

const logger = makeLogger('TestPayloadLoader')

/**
 * The test payload read in from filesystem
 */
export interface Payload {
  requests: Array<AdapterRequestData>
}

/**
 * Test payload with discriminated union so we can tell when we should just do
 * a simple liveness check rather than a sample request
 */
type TestPayload = (Payload & { isDefault: false }) | { isDefault: true }

/**
 * Load in a JSON file containing a test payload for the current adapter,
 * used in healthchecks to make sample requests
 *
 * @param fileName - name of file that contains the test payload data for the smoke endpoint
 * @returns the parsed payload with individual requests
 */
export function loadTestPayload(fileName?: string): TestPayload {
  const ajv = new Ajv()
  const schema = {
    type: 'object',
    required: ['requests'],
    properties: {
      requests: {
        type: 'array',
        items: {
          type: 'object',
          required: [],
        },
      },
    },
  }
  const validate = ajv.compile(schema)
  try {
    const payload = resolvePayload(fileName)
    if (!validate(payload) || !payload?.requests) {
      throw Error(JSON.stringify(validate?.errors || 'Could not validate schema for test payload'))
    }
    return { ...payload, isDefault: false }
  } catch (e: unknown) {
    logger.warn(`Could not load payload: ${(e as Error).message}`)
    logger.warn('Falling back to default empty payload')
    return { isDefault: true }
  }
}

export function resolvePayload(fileName?: string): Payload | null {
  try {
    let payload = null
    // Find test payload by specified name, fallback to default names if not found
    if (fileName && fs.existsSync(path.join(process.cwd(), fileName))) {
      payload = require(path.join(process.cwd(), fileName))
    } else if (fileName && fs.existsSync(`./${fileName}`)) {
      payload = require(`./${fileName}`)
    }
    // Search for test payload js first if no filename specified or found
    else if (fs.existsSync(path.resolve('.', 'test-payload.js'))) {
      payload = require(path.join(process.cwd(), 'test-payload.js'))
    } else if (fs.existsSync(`./test-payload.js`)) {
      payload = require(`./test-payload.js`)
    }
    // Search for test payload json second if no filename specified or found
    else if (fs.existsSync(path.join(process.cwd(), 'test-payload.json'))) {
      payload = require(path.join(process.cwd(), 'test-payload.json'))
    } else if (fs.existsSync(`./test-payload.json`)) {
      payload = require(`./test-payload.json`)
    }
    if (typeof payload === 'string') {
      return JSON.parse(payload)
    } else {
      return payload
    }
  } catch {
    return null
  }
}
