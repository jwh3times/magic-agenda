import { describe, expect, it } from 'vitest'
import {
  LOCAL_E2E_EMAIL,
  LOCAL_E2E_PASSWORD,
  TURNSTILE_TEST_SITE_KEY,
  localE2EEnvironment,
  parseLocalStack,
} from './e2e-local-setup'

describe('local E2E setup', () => {
  it('extracts the local stack without publishing its administrative key', () => {
    const stack = parseLocalStack(
      JSON.stringify({
        API_URL: 'http://127.0.0.1:54321',
        ANON_KEY: 'local-anon',
        SERVICE_ROLE_KEY: 'local-admin',
      }),
    )

    expect(localE2EEnvironment(stack)).toEqual({
      VITE_SUPABASE_URL: 'http://127.0.0.1:54321',
      VITE_SUPABASE_ANON_KEY: 'local-anon',
      VITE_TURNSTILE_SITE_KEY: TURNSTILE_TEST_SITE_KEY,
      E2E_BASE_URL: 'http://127.0.0.1:4173',
      E2E_SUPABASE_URL: 'http://127.0.0.1:54321',
      E2E_SUPABASE_ANON_KEY: 'local-anon',
      E2E_TEST_EMAIL: LOCAL_E2E_EMAIL,
      E2E_TEST_PASSWORD: LOCAL_E2E_PASSWORD,
    })
    expect(Object.values(localE2EEnvironment(stack))).not.toContain('local-admin')
  })

  it('rejects an incomplete CLI status payload', () => {
    expect(() => parseLocalStack('{"API_URL":"http://127.0.0.1:54321"}')).toThrow(
      'Supabase status did not report a usable anonKey.',
    )
  })
})
