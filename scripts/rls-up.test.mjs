// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DUMMY_ENV, EXCLUDED_SERVICES, stackEnv } from './rls-up.mjs'

/**
 * The point of this script is that a local stack matches CI's, so the assertions that matter are
 * the ones comparing the two. Prose in AGENTS.md saying "keep these aligned" is what drifted
 * everywhere else in this repo; a parsed comparison is what does not.
 */
const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')
const step = workflow.split('      - name: Start a local stack\n')[1]

describe('stackEnv', () => {
  it('overrides a real secret already present in the environment', () => {
    // The whole reason the script exists: `op run` with the production template exports the real
    // key, config.toml wires it to smtp.resend.com, and a local GoTrue could then send real mail.
    const merged = stackEnv({ RESEND_API_KEY: 'live-key', PATH: '/usr/bin' })
    expect(merged.RESEND_API_KEY).toBe(DUMMY_ENV.RESEND_API_KEY)
    expect(merged.RESEND_API_KEY).not.toBe('live-key')
  })

  it('keeps unrelated environment variables', () => {
    expect(stackEnv({ PATH: '/usr/bin' }).PATH).toBe('/usr/bin')
  })

  it('never carries a value that looks like a real credential', () => {
    for (const [key, value] of Object.entries(DUMMY_ENV)) {
      expect(value, key).toMatch(/dummy|local/)
    }
  })
})

describe('parity with the CI job', () => {
  it('sets exactly the variables the CI stack step sets', () => {
    const envBlock = step.split('        env:\n')[1].split('\n      - ')[0]
    const ciKeys = envBlock
      .split('\n')
      .map((line) => line.match(/^ {10}([A-Z0-9_]+):/)?.[1])
      .filter((key) => key !== undefined)
      .sort()
    expect(ciKeys.length).toBeGreaterThan(0)
    expect(Object.keys(DUMMY_ENV).sort()).toEqual(ciKeys)
  })

  it('excludes the same services, so the two stacks are the same stack', () => {
    expect(step).toContain(`npx supabase start -x ${EXCLUDED_SERVICES}`)
  })
})
