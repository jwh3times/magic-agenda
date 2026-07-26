import { expect, test } from 'vitest'
import { supabase } from './supabase'

// Regression guard for the 2026-07-25 security review Finding 1 (session fixation).
// flowType 'pkce' alone does NOT close the hole: auth-js classifies fragment URLs as
// implicit callbacks regardless of flowType. The function form of detectSessionInUrl
// is the real control — _isImplicitGrantCallback delegates to it.
test('auth client uses PKCE and never adopts implicit-grant tokens from the URL', () => {
  const auth = supabase.auth as unknown as {
    flowType: string
    detectSessionInUrl: boolean | ((url: URL, params: Record<string, string>) => boolean)
  }
  expect(auth.flowType).toBe('pkce')
  expect(typeof auth.detectSessionInUrl).toBe('function')
  const detect = auth.detectSessionInUrl as (url: URL, params: Record<string, string>) => boolean
  expect(
    detect(new URL('https://magicagenda.app/#access_token=evil&refresh_token=evil'), {
      access_token: 'evil',
      refresh_token: 'evil',
    }),
  ).toBe(false)
})
