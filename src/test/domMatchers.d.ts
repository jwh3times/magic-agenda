/* oxlint-disable typescript/no-empty-object-type -- Module augmentation must be an interface. */
import type { TestingLibraryMatchers } from '@testing-library/jest-dom/matchers'
import 'vitest'

// Vitest 5 reads Matchers rather than global jest.Matchers. The jest-dom 7.0.1
// /vitest adapter still augments the older Assertion<T> interface.
declare module 'vitest' {
  interface Matchers<
    R extends void | Promise<void> = void | Promise<void>,
    T = unknown,
  > extends TestingLibraryMatchers<T, R> {}
}
