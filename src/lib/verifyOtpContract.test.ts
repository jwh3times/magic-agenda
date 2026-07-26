import { expect, test } from 'vitest'
import { GoTrueClient } from '@supabase/auth-js'
import type { AuthChangeEvent } from '@supabase/auth-js'

// This pins a vendor contract (auth-js 2.110.8 behavior at GoTrueClient#verifyOtp) that
// ResetPassword + AuthProvider rely on: verifyOtp({ type: 'recovery' }) must emit
// PASSWORD_RECOVERY to onAuthStateChange subscribers BEFORE the verifyOtp promise resolves
// (GoTrueClient.js:2018 in this version -- `await this._notifyAllSubscribers(params.type ==
// 'recovery' ? 'PASSWORD_RECOVERY' : 'SIGNED_IN', session)`, awaited after `_saveSession`, inside
// verifyOtp itself, ahead of its own `return`). Nothing else in the app's unit tests exercises the
// real auth-js client, so a Dependabot bump that changes this ordering would ship silently. If this
// test breaks on a dependency bump, the recovery flow is broken even though app unit tests stay
// green -- see docs/specs/2026-07-25-pkce-auth-flow-design.md "Why the recovery gate still works".

function makeSessionPayload(overrides: { id: string; email: string }) {
  return {
    access_token: 'contract-at',
    token_type: 'bearer',
    expires_in: 3600,
    refresh_token: 'contract-rt',
    user: {
      id: overrides.id,
      aud: 'authenticated',
      email: overrides.email,
      app_metadata: {},
      user_metadata: {},
      created_at: new Date().toISOString(),
    },
  }
}

function makeClient(sessionPayload: unknown) {
  return new GoTrueClient({
    url: 'http://localhost:54321/auth/v1',
    fetch: async () =>
      new Response(JSON.stringify(sessionPayload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
  })
}

test('verifyOtp({ type: "recovery" }) fires PASSWORD_RECOVERY before the promise resolves', async () => {
  const client = makeClient(makeSessionPayload({ id: 'u-contract', email: 'c@x.co' }))
  const events: AuthChangeEvent[] = []
  client.onAuthStateChange((event) => {
    events.push(event)
  })

  const { data } = await client.verifyOtp({ token_hash: 'contract-token', type: 'recovery' })

  // No extra awaits/ticks between the call above and this assertion: that immediacy is the
  // proof the event fired synchronously-within-the-promise-chain before verifyOtp resolved,
  // not merely "at some point before this test ends".
  expect(events).toContain('PASSWORD_RECOVERY')
  expect(data.session?.access_token).toBe('contract-at')
})

test('verifyOtp({ type: "signup" }) fires SIGNED_IN, not PASSWORD_RECOVERY', async () => {
  const client = makeClient(makeSessionPayload({ id: 'u-contract-2', email: 'c2@x.co' }))
  const events: AuthChangeEvent[] = []
  client.onAuthStateChange((event) => {
    events.push(event)
  })

  const { data } = await client.verifyOtp({ token_hash: 'contract-token-2', type: 'signup' })

  expect(events).toContain('SIGNED_IN')
  expect(events).not.toContain('PASSWORD_RECOVERY')
  expect(data.session?.access_token).toBe('contract-at')
})
