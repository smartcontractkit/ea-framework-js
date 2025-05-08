import Ajv, { AnySchema, ValidateFunction } from 'ajv'

/**
 * A single Ajv instance shared by the whole process.
 *  - `allErrors` ➜ full error list (useful for logging)
 *  - `strict:false` ➜ keeps existing “extra property” behaviour unchanged
 */
const ajv = new Ajv({ allErrors: true, strict: false })

/**
 * WeakMap caches *object* schemas ➜ compiled validators.
 * Boolean schemas (true/false) can’t be used as WeakMap keys, so we’ll
 * compile them each time—they are extremely rare and tiny.
 */
const compiled = new WeakMap<object, ValidateFunction>()

/**
 * Return a compiled Ajv validator, compiling at most once per *object* schema.
 * Boolean schemas bypass the cache (still safe and very cheap).
 */
export function getValidator<T = unknown>(schema: AnySchema): ValidateFunction<T> {
  if (typeof schema === 'object' && schema !== null) {
    let fn = compiled.get(schema) as ValidateFunction<T> | undefined
    if (!fn) {
      fn = ajv.compile<T>(schema)
      compiled.set(schema, fn)
    }
    return fn
  }

  // Schema is `true` or `false` – compile but don’t cache
  return ajv.compile<T>(schema)
}
