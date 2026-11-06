// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'

/**
 * `scripts/config-preview.sh` — the required `Config` check's bounded, retried preview (#429),
 * reading `supabase config diff --exit-code` since Supabase CLI v3 (#640).
 *
 * The real `supabase config diff` is replaced through `CONFIG_PREVIEW_COMMAND` with small shell
 * programs that reproduce each outcome: no difference (exit 0), pending differences (exit 2), a
 * hang, a transient failure, and a persistent one. Timeouts and backoff are shrunk to keep the
 * suite fast; the classification is the thing under test, not the durations.
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

test('the default command is the read-only config diff, never config push', () => {
  const fallback = /CONFIG_PREVIEW_COMMAND:-([^}]*)\}/.exec(readFileSync(script, 'utf8'))?.[1]
  expect(fallback).toContain('supabase config diff --exit-code')
  expect(fallback).not.toContain('push')
  expect(fallback).not.toContain('--yes')
})

test('no difference passes without retrying', () => {
  const { code, out } = preview('echo "No changes found."; exit 0')
  expect(code).toBe(0)
  expect(out).toContain('No pending changes')
  expect(out).not.toContain('Attempt 1 of 2')
})

test('pending differences pass, and the diff reaches the job summary', () => {
  const { code, out } = preview('echo "~ auth.site_url"; exit 2')
  expect(code).toBe(0)
  expect(out).toContain('Pending changes listed above')
  expect(readFileSync(join(dir, 'summary.md'), 'utf8')).toContain('~ auth.site_url')
})

test('the preview never hands the command a stdin it could read an answer from', () => {
  const { code, out } = preview(
    'if read -r line; then echo "read=$line"; else echo "stdin=eof"; fi',
  )
  expect(code).toBe(0)
  expect(out).toContain('stdin=eof')
})

test('a hang is cut off at the per-attempt bound, retried, and then fails', () => {
  const started = Date.now()
  const { code, out } = preview('sleep 20')
  expect(code).toBe(1)
  expect(out).toContain('Attempt 1 of 2: config diff timed out after 1s')
  expect(out).toContain('Attempt 2 of 2: config diff timed out after 1s')
  expect(out).toContain('The check stays red')
  // Two one-second attempts, not twenty seconds of hanging.
  expect(Date.now() - started).toBeLessThan(15_000)
})

test('a transient failure is retried and can then pass', () => {
  const marker = join(dir, 'tried').replace(/\\/g, '/')
  const { code, out } = preview(
    `if [ -f "${marker}" ]; then exit 0; else touch "${marker}"; echo "rate limited"; exit 1; fi`,
  )
  expect(code).toBe(0)
  expect(out).toContain('Attempt 1 of 2: config diff failed (exit 1)')
  expect(out).toContain('No pending changes')
})

test('a persistent failure fails after the last attempt', () => {
  const { code, out } = preview('echo "invalid config"; exit 3')
  expect(code).toBe(1)
  expect(out).toContain('Attempt 2 of 2: config diff failed (exit 3)')
  expect(out).toContain('The check stays red')
})
