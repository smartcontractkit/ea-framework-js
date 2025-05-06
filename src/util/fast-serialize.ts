/**
 * Fast serialization module for EA response objects
 * 
 * This module provides optimized JSON serialization for common EA response patterns,
 * significantly reducing CPU usage, GC pressure, and improving response times
 * under high load scenarios.
 */

// Import required types and metrics
import { AdapterResponse, ResponseGenerics } from './types'
import { metrics } from '../metrics'

/**
 * Fast path response serialization
 * 
 * This implementation uses specialized object detection and hand-optimized
 * JSON string construction for common response patterns, avoiding the overhead
 * of the full JSON.stringify process. For complex or unusual responses, it 
 * falls back to standard JSON.stringify.
 *
 * @param response - The response object to serialize
 * @returns JSON string representation of the response
 */
export function serializeResponse<T extends ResponseGenerics>(
  response: AdapterResponse<T>
): string {
  const startTime = performance.now()
  let result: string
  let mode: 'fast' | 'standard' = 'fast'
  
  try {
    // Standard success response fast path
    if (
      typeof response.statusCode === 'number' && 
      response.statusCode >= 200 && 
      response.statusCode < 300 &&
      'data' in response && 
      'result' in response
    ) {
      result = serializeSuccessResponse(response as AdapterResponse<T>)
    }
    // Error response fast path
    else if (
      typeof response.statusCode === 'number' && 
      response.statusCode >= 400 && 
      'errorMessage' in response
    ) {
      result = serializeErrorResponse(response as AdapterResponse<T>)
    }
    // Handle batch responses
    else if (
      typeof response.statusCode === 'number' && 
      response.statusCode >= 200 && 
      response.statusCode < 300 &&
      'data' in response && 
      typeof response.data === 'object' &&
      response.data !== null &&
      'results' in response.data && 
      Array.isArray(response.data.results)
    ) {
      // For batch responses, use standard JSON.stringify as they tend to be
      // more complex and variable in structure
      result = JSON.stringify(response)
    }
    // Fallback for non-standard responses
    else {
      mode = 'standard'
      result = JSON.stringify(response)
    }
  } catch (e) {
    // If any error occurs, fall back to standard serialization
    mode = 'standard'
    result = JSON.stringify(response)
  }
  
  // Record metrics
  const duration = (performance.now() - startTime) / 1000 // Convert to seconds
  metrics.get('eaResponseSerializationDurationSeconds').labels({ mode }).observe(duration)
  
  return result
}

/**
 * Specialized serializer for standard success responses
 */
function serializeSuccessResponse<T extends ResponseGenerics>(
  response: AdapterResponse<T>
): string {
  const { statusCode, data, result, timestamps, meta } = response as any

  let json = '{'
  
  // Add statusCode
  json += `"statusCode":${statusCode || 200}`
  
  // Add data
  if (data !== undefined) {
    json += ',"data":'
    if (typeof data === 'object' && data !== null) {
      json += JSON.stringify(data)
    } else {
      json += 'null'
    }
  }
  
  // Add result
  if (result !== undefined) {
    json += ',"result":'
    if (typeof result === 'string') {
      json += `"${escapeString(result)}"`
    } else if (result === null) {
      json += 'null'
    } else if (typeof result === 'object') {
      // Handle object types properly
      json += JSON.stringify(result)
    } else {
      json += result
    }
  }
  
  // Add timestamps
  if (timestamps) {
    json += ',"timestamps":'
    json += JSON.stringify(timestamps)
  }
  
  // Add meta if present
  if (meta) {
    json += ',"meta":'
    json += JSON.stringify(meta)
  }
  
  json += '}'
  
  return json
}

/**
 * Specialized serializer for error responses
 */
function serializeErrorResponse<T extends ResponseGenerics>(
  response: AdapterResponse<T>
): string {
  const { statusCode, errorMessage, timestamps } = response as any
  
  let json = '{'
  
  // Add statusCode
  json += `"statusCode":${statusCode}`
  
  // Add errorMessage
  if (errorMessage !== undefined) {
    if (typeof errorMessage === 'string') {
      json += `,"errorMessage":"${escapeString(errorMessage)}"`
    } else {
      // For non-string error messages, use JSON.stringify
      json += `,"errorMessage":${JSON.stringify(errorMessage)}`
    }
  }
  
  // Add timestamps
  if (timestamps) {
    json += ',"timestamps":'
    json += JSON.stringify(timestamps)
  }
  
  json += '}'
  
  return json
}

/**
 * Helper function to escape strings in JSON
 */
function escapeString(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
    .replace(/\f/g, '\\f')
} 