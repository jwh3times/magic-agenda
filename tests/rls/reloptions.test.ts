import { expect, test } from 'vitest'
import { isSecurityInvoker } from './reloptions'

// These need no database. They exist because the definer-view assertion in structure.test.ts
// asserts over zero rows today -- without them this parsing would ship completely untested.

test('recognises every boolean spelling Postgres stores', () => {
  for (const opt of [
    'security_invoker=true',
    'security_invoker=on',
    'security_invoker=yes',
    'security_invoker=1',
  ]) {
    expect(isSecurityInvoker([opt])).toBe(true)
  }
})

test('tolerates the spacing of `WITH (security_invoker = on)`', () => {
  expect(isSecurityInvoker(['security_invoker = on'])).toBe(true)
  expect(isSecurityInvoker(['  security_invoker=TRUE  '])).toBe(true)
})

test('finds the option among unrelated reloptions', () => {
  expect(isSecurityInvoker(['check_option=cascaded', 'security_invoker=true'])).toBe(true)
})

test('treats a definer view as not invoker', () => {
  expect(isSecurityInvoker(null)).toBe(false)
  expect(isSecurityInvoker([])).toBe(false)
  expect(isSecurityInvoker(['check_option=local'])).toBe(false)
  expect(isSecurityInvoker(['security_invoker=false'])).toBe(false)
  expect(isSecurityInvoker(['security_invoker=off'])).toBe(false)
})

test('fails safe on an unrecognised spelling', () => {
  // Postgres accepts `t` on input but does not store it. If that ever changes, this returns
  // false -- flagging a SAFE view for review rather than trusting an unsafe one.
  expect(isSecurityInvoker(['security_invoker=t'])).toBe(false)
})
