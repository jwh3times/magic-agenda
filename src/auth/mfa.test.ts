import { expect, test } from 'vitest'
import { nextFactorName, qrDataUri, stepUpRequired, type TotpFactor } from './mfa'

function factor(over: Partial<TotpFactor> = {}): TotpFactor {
  return {
    id: 'f1',
    name: 'Authenticator',
    verified: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

// ——— the gate ———

test('a session that has not presented a factor it owns must step up', () => {
  expect(stepUpRequired({ current: 'aal1', next: 'aal2' })).toBe(true)
})

test('a session that has already presented one does not', () => {
  expect(stepUpRequired({ current: 'aal2', next: 'aal2' })).toBe(false)
})

test('a user with no verified factor is never gated', () => {
  expect(stepUpRequired({ current: 'aal1', next: 'aal1' })).toBe(false)
})

test('an unreadable or absent level is not a gate', () => {
  // GoTrue types both levels as nullable, and a null `next` cannot mean "you owe a code" — there
  // is no factor for it to refer to. Gating here would lock a user out of their own data behind a
  // prompt no authenticator could satisfy, and MFA is not the authorization boundary anyway: RLS
  // keys on auth.uid(), so the database grants exactly the same rows either way.
  expect(stepUpRequired({ current: null, next: null })).toBe(false)
  expect(stepUpRequired({ current: 'aal1', next: null })).toBe(false)
})

test('an assurance level GoTrue has not defined yet still gates when aal2 is owed', () => {
  // `AuthenticatorAssuranceLevels` is an open union. Asking "is next aal2 and current not" keeps
  // gating for any current level that isn't aal2; asking "is current aal1" would stop.
  expect(stepUpRequired({ current: 'aal0', next: 'aal2' })).toBe(true)
})

// ——— naming ———

test('the first factor takes the base name', () => {
  expect(nextFactorName([])).toBe('Authenticator')
})

test('a second factor is numbered past the first', () => {
  expect(nextFactorName([factor({ name: 'Authenticator' })])).toBe('Authenticator 2')
})

test('numbering skips names already taken rather than counting factors', () => {
  // Removing "Authenticator 2" of three leaves a hole. Counting would propose "Authenticator 3",
  // which GoTrue would reject with mfa_factor_name_conflict.
  const existing = [
    factor({ id: 'a', name: 'Authenticator' }),
    factor({ id: 'c', name: 'Authenticator 3' }),
  ]
  expect(nextFactorName(existing)).toBe('Authenticator 2')
})

test('an unverified factor still holds its name', () => {
  // It occupies a slot against max_enrolled_factors and would collide just the same.
  expect(nextFactorName([factor({ name: 'Authenticator', verified: false })])).toBe(
    'Authenticator 2',
  )
})

test('a factor with no name never collides with a generated one', () => {
  expect(nextFactorName([factor({ name: null })])).toBe('Authenticator')
})

// ——— the QR data URI ———

test('the QR survives a fill colour, which a raw prepend would truncate', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="#000000"/></svg>'
  const uri = qrDataUri(svg)
  expect(uri.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true)
  expect(uri).not.toContain('#')
  expect(decodeURIComponent(uri.slice('data:image/svg+xml;charset=utf-8,'.length))).toBe(svg)
})
