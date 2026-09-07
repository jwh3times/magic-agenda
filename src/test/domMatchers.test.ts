import { type Assertion, expect, expectTypeOf, test } from 'vitest'

test('DOM matchers preserve synchronous and asynchronous assertion return types', async () => {
  const element = document.createElement('button')
  element.textContent = 'Save'

  const synchronous = expect(element).toHaveTextContent('Save')
  expectTypeOf(synchronous).toEqualTypeOf<void>()

  expectTypeOf<
    ReturnType<Assertion<Promise<void>, HTMLButtonElement>['toHaveTextContent']>
  >().toEqualTypeOf<Promise<void>>()
  await expect(Promise.resolve(element)).resolves.toHaveTextContent('Save')
  expect(element).not.toHaveTextContent('Delete')
  expect(() => expect(element).toHaveTextContent('Delete')).toThrow()
})
