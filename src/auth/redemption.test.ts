import { expect, test } from 'vitest'
import { readTokenHash, redeemDecision } from './redemption'

const base = { loading: false, hasSession: false, tokenHash: null as string | null }

// ——— the security property ———

test('refuses to redeem a VALID token over an existing session', () => {
  // This is the session-fixation guard from the 2026-07-25 security review, and the reason
  // `hasSession` is tested before `tokenHash`. If these two clauses are ever reordered, this is
  // the test that fails — the others would all still pass.
  expect(redeemDecision({ ...base, hasSession: true, tokenHash: 'valid-token' })).toEqual({
    kind: 'refuse',
    hadToken: true,
  })
})

test('refuses with hadToken false when a signed-in user arrives with no link', () => {
  // Drives copy only. Before the guard was shared, this case told the user their "reset link
  // wasn't used" when there had been no link at all.
  expect(redeemDecision({ ...base, hasSession: true })).toEqual({ kind: 'refuse', hadToken: false })
})

test('never decides anything while auth state is still loading', () => {
  // Deciding early would refuse against a session that simply had not loaded yet, burning the
  // token's only chance for a legitimately signed-out user.
  expect(redeemDecision({ ...base, loading: true, tokenHash: 'tok' })).toEqual({ kind: 'wait' })
  expect(redeemDecision({ ...base, loading: true, hasSession: true, tokenHash: 'tok' })).toEqual({
    kind: 'wait',
  })
})

// ——— the ordinary paths ———

test('redeems a token for a signed-out visitor', () => {
  expect(redeemDecision({ ...base, tokenHash: 'tok' })).toEqual({
    kind: 'redeem',
    tokenHash: 'tok',
  })
})

test('no session and no token is idle, not a redemption attempt', () => {
  expect(redeemDecision(base)).toEqual({ kind: 'idle' })
})

test('an empty-string token counts as absent everywhere, not just in one branch', () => {
  // `?token_hash=` reads as '' rather than null. Left unnormalized it is falsy in the redeem
  // clause but truthy in `hadToken`, so the page would refuse a link it also reported as missing.
  expect(redeemDecision({ ...base, tokenHash: '' })).toEqual({ kind: 'idle' })
  expect(redeemDecision({ ...base, hasSession: true, tokenHash: '' })).toEqual({
    kind: 'refuse',
    hadToken: false,
  })
})

test('readTokenHash normalizes the query string', () => {
  expect(readTokenHash('?token_hash=abc&type=recovery')).toBe('abc')
  expect(readTokenHash('?token_hash=')).toBeNull()
  expect(readTokenHash('?type=recovery')).toBeNull()
  expect(readTokenHash('')).toBeNull()
})
