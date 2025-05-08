import test from 'ava'
import { getValidator } from '../../src/validation/schema-cache'

test('getValidator caches compiled object schemas', (t) => {
  // Create an object schema
  const objectSchema = {
    type: 'object',
    properties: {
      foo: { type: 'string' },
      bar: { type: 'number' },
    },
    required: ['foo'],
  }

  // Get the validator for the same schema twice
  const validator1 = getValidator(objectSchema)
  const validator2 = getValidator(objectSchema)

  // Test that they are the same instance (cached)
  t.is(validator1, validator2)

  // Verify the validator works correctly
  t.true(validator1({ foo: 'test' }))
  t.false(validator1({ bar: 123 }))
})

test('getValidator handles boolean schemas', (t) => {
  // Test the true schema (accepts anything)
  const trueValidator = getValidator(true)
  t.true(trueValidator({ any: 'value' }))
  t.true(trueValidator('string'))
  t.true(trueValidator(123))

  // Test the false schema (rejects anything)
  const falseValidator = getValidator(false)
  t.false(falseValidator({ any: 'value' }))
  t.false(falseValidator('string'))
  t.false(falseValidator(123))

  // Get boolean validators again
  const trueValidator2 = getValidator(true)
  const falseValidator2 = getValidator(false)

  // Verify they still work correctly
  t.true(trueValidator2({ any: 'value' }))
  t.false(falseValidator2({ any: 'value' }))
})

test('getValidator validates against the provided schema', (t) => {
  const numberSchema = {
    type: 'number',
    minimum: 10,
    maximum: 100,
  }

  const validator = getValidator(numberSchema)

  // Valid values
  t.true(validator(10))
  t.true(validator(50))
  t.true(validator(100))

  // Invalid values
  t.false(validator(9))
  t.false(validator(101))
  t.false(validator('50')) // Wrong type
})

test('getValidator handles complex schemas', (t) => {
  const complexSchema = {
    type: 'object',
    properties: {
      name: { type: 'string' },
      age: { type: 'number', minimum: 0 },
      address: {
        type: 'object',
        properties: {
          street: { type: 'string' },
          city: { type: 'string' },
        },
        required: ['street', 'city'],
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
      },
    },
    required: ['name', 'age'],
  }

  const validator = getValidator(complexSchema)

  // Valid object
  t.true(
    validator({
      name: 'John',
      age: 30,
      address: {
        street: '123 Main St',
        city: 'Anytown',
      },
      tags: ['developer', 'researcher'],
    }),
  )

  // Invalid objects
  t.false(
    validator({
      name: 'John',
      // Missing age
    }),
  )

  t.false(
    validator({
      name: 'John',
      age: 30,
      address: {
        street: '123 Main St',
        // Missing city
      },
    }),
  )
})
