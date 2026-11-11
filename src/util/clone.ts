/** JSON-based deep clone used to isolate framework-owned values from policy and validator hooks. */
export const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

/** Clone a value, returning undefined when it cannot be serialized. */
export const tryClone = <T>(value: T): T | undefined => {
  try {
    return clone(value)
  } catch {
    return undefined
  }
}
