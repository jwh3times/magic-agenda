// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const root = new URL('../', import.meta.url)
const read = (path: string) => readFileSync(new URL(path, root), 'utf8')

describe('Supabase Turnstile configuration', () => {
  it('enables Turnstile with a secret resolved only from the environment', () => {
    expect(read('supabase/config.toml')).toContain(
      '[auth.captcha]\nenabled = true\nprovider = "turnstile"\nsecret = "env(TURNSTILE_SECRET_KEY)"',
    )
  })

  it.each([
    '.github/workflows/ci.yml',
    '.github/workflows/deploy-auth-config.yml',
    '.github/workflows/deploy-functions.yml',
    '.github/workflows/deploy-migrations.yml',
    '.github/workflows/backup.yml',
  ])('%s provides the secret whenever the CLI parses config.toml', (path) => {
    expect(read(path)).toContain('TURNSTILE_SECRET_KEY: ${{ secrets.TURNSTILE_SECRET_KEY }}')
  })

  it('uses dummies for browser builds and the local auth stack', () => {
    const ci = read('.github/workflows/ci.yml')
    expect(ci).toContain('VITE_TURNSTILE_SITE_KEY: ci-placeholder')
    expect(ci).toContain('TURNSTILE_SECRET_KEY: dummy-not-a-real-secret')
    expect(read('scripts/rls-up.mjs')).toContain("TURNSTILE_SECRET_KEY: 'dummy-not-a-real-secret'")
  })
})

describe('Turnstile Content Security Policy', () => {
  it('allows the documented script and frame origin', () => {
    const headers = read('public/_headers')
    const csp = headers.split('  Content-Security-Policy: ')[1]?.split('\n')[0] ?? ''
    expect(csp).toContain('script-src')
    expect(csp).toContain('https://challenges.cloudflare.com')
    expect(csp).toContain('frame-src https://challenges.cloudflare.com')
  })
})
