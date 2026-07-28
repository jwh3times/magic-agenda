import { expect, test } from 'vitest'
import { clearLastUserId, readLastUserId, writeLastUserId } from './lastUser'

test('round-trips the id and clears it', () => {
  expect(readLastUserId()).toBe('')
  writeLastUserId('u1')
  expect(readLastUserId()).toBe('u1')
  clearLastUserId()
  expect(readLastUserId()).toBe('')
})
