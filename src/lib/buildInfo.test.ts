import { expect, test } from 'vitest'
import { buildLabel } from './buildInfo'

test('a release shows its version and commit', () => {
  expect(buildLabel({ version: '1.17.22', commit: 'a37c862' })).toBe('v1.17.22 · a37c862')
})

test('a build with no version shows its commit', () => {
  expect(buildLabel({ version: null, commit: 'a37c862' })).toBe('Build a37c862')
})

test('a version with no commit still shows', () => {
  expect(buildLabel({ version: '1.17.22', commit: null })).toBe('v1.17.22')
})

test('a build that knows neither shows nothing', () => {
  expect(buildLabel({ version: null, commit: null })).toBeNull()
})
