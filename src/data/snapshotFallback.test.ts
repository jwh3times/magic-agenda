import { expect, test } from 'vitest'
import { dominantSnapshotFallbackReason, snapshotFallbackReason } from './snapshotFallback'

test('classifies the stable Supabase response status instead of vendor message text', () => {
  expect(snapshotFallbackReason(0)).toBe('network')
  expect(snapshotFallbackReason(401)).toBe('auth')
  expect(snapshotFallbackReason(403)).toBe('auth')
  expect(snapshotFallbackReason(400)).toBe('request-error')
  expect(snapshotFallbackReason(500)).toBe('request-error')
})

test('the most actionable Board failure wins over a simultaneous network failure', () => {
  expect(dominantSnapshotFallbackReason(['network', null, 'request-error'])).toBe('request-error')
  expect(dominantSnapshotFallbackReason(['request-error', 'auth', 'network'])).toBe('auth')
  expect(dominantSnapshotFallbackReason([null, null])).toBeNull()
})
