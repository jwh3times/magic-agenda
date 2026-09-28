// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'

/**
 * `scripts/config-preview.sh` — the required `Config` check's bounded, retried preview (#429).
 *
 * The real `supabase config push` is replaced through `CONFIG_PREVIEW_COMMAND` with small shell
 * programs that reproduce each outcome: nothing pending, prompts declined, a hang, a hang after
 * some prompts, a transient failure, and a persistent one. Timeouts and backoff are shrunk to keep
 * the suite fast; the classification is the thing under test, not the durations.
 */

const script = join(process.cwd(), 'scripts', 'config-preview.sh')
let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'config-preview-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function preview(command: string, over: Record<string, string> = {}) {
  const result = spawnSync('bash', [script], {
    encoding: 'utf8',
    timeout: 30_000,
    env: {
      ...process.env,
      CONFIG_PREVIEW_COMMAND: command,
      CONFIG_PREVIEW_ATTEMPT_TIMEOUT: '1',
      CONFIG_PREVIEW_ATTEMPTS: '2',
      CONFIG_PREVIEW_BACKOFF: '0',
      GITHUB_STEP_SUMMARY: join(dir, 'summary.md'),
      ...over,
    },
  })
  return { code: result.status, out: `${result.stdout}${result.stderr}` }
}

test('no pending changes passes without retrying', () => {
  const { code, out } = preview('echo "Remote config is up to date."')
  expect(code).toBe(0)
  expect(out).toContain('No pending changes')
  expect(out).not.toContain('Attempt 1 of 2')
})

test('declined prompts pass, and the preview really answers them with n', () => {
  const { code, out } = preview(
    'echo "Do you want to push auth config? [y/N]"; read answer; echo "answer=$answer"; exit 1',
  )
  expect(code).toBe(0)
  expect(out).toContain('answer=n')
  expect(out).toContain('1 pending change prompt(s), all declined')
})

test('a hang is cut off at the per-attempt bound, retried, and then fails', () => {
  const started = Date.now()
  const { code, out } = preview('sleep 20')
  expect(code).toBe(1)
  expect(out).toContain('Attempt 1 of 2: config push timed out after 1s')
  expect(out).toContain('Attempt 2 of 2: config push timed out after 1s')
  expect(out).toContain('The check stays red')
  // Two one-second attempts, not twenty seconds of hanging.
  expect(Date.now() - started).toBeLessThan(15_000)
})

test('a hang after some prompts still fails: the preview did not reach every service', () => {
  const { code, out } = preview(
    'echo "Do you want to push auth config? [y/N]"; read answer; sleep 20',
  )
  expect(code).toBe(1)
  expect(out).toContain('timed out')
  expect(out).not.toContain('all declined')
})

test('a transient failure before any prompt is retried and can then pass', () => {
  const marker = join(dir, 'tried').replace(/\\/g, '/')
  const { code, out } = preview(
    `if [ -f "${marker}" ]; then echo "Remote config is up to date."; else touch "${marker}"; echo "rate limited"; exit 1; fi`,
  )
  expect(code).toBe(0)
  expect(out).toContain('failed before reaching any confirmation prompt (exit 1)')
  expect(out).toContain('No pending changes')
})

test('a persistent failure before any prompt fails after the last attempt', () => {
  const { code, out } = preview('echo "invalid config"; exit 3')
  expect(code).toBe(1)
  expect(out).toContain(
    'Attempt 2 of 2: config push failed before reaching any confirmation prompt (exit 3)',
  )
})
