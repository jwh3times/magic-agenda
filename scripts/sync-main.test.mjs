import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import {
  DEFAULT_TARGET,
  PRIVATE_ROOT_ENV,
  TARGET_BRANCH,
  describeResult,
  isDirty,
  parseArgs,
  syncRepository,
} from './sync-main.mjs'

const scratch = []

function tempDir() {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'magic-agenda-sync-main-'))
  scratch.push(directory)
  return directory
}

afterEach(() => {
  for (const directory of scratch.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function git(root, ...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' })
}

/** A bare origin with one commit on main, plus a clone of it. */
function repoPair() {
  const base = tempDir()
  const origin = path.join(base, 'origin.git')
  const seed = path.join(base, 'seed')
  const clone = path.join(base, 'clone')
  git(base, 'init', '--bare', '--initial-branch=main', origin)
  git(base, 'clone', origin, seed)
  git(seed, 'config', 'user.email', 'test@example.com')
  git(seed, 'config', 'user.name', 'Test')
  writeFileSync(path.join(seed, 'README.md'), 'one\n')
  git(seed, 'add', '.')
  git(seed, 'commit', '-m', 'one')
  git(seed, 'push', 'origin', 'main')
  git(base, 'clone', origin, clone)
  git(clone, 'config', 'user.email', 'test@example.com')
  git(clone, 'config', 'user.name', 'Test')
  return { origin, clone }
}

function pushCommit(origin, message) {
  const work = path.join(tempDir(), 'work')
  git(path.dirname(work), 'clone', origin, work)
  git(work, 'config', 'user.email', 'test@example.com')
  git(work, 'config', 'user.name', 'Test')
  writeFileSync(path.join(work, `${message}.txt`), `${message}\n`)
  git(work, 'add', '.')
  git(work, 'commit', '-m', message)
  git(work, 'push', 'origin', 'main')
}

describe('parseArgs', () => {
  test('defaults to both repositories and the private companion', () => {
    expect(parseArgs([], {})).toEqual({ target: DEFAULT_TARGET, syncPrivate: true })
  })

  test('reads the companion root from the environment', () => {
    expect(parseArgs([], { [PRIVATE_ROOT_ENV]: ' ../ops ' }).target).toBe('../ops')
  })

  test('accepts every flag and lets the target flag override the environment', () => {
    expect(
      parseArgs(['--target', '/elsewhere', '--skip-private'], {
        [PRIVATE_ROOT_ENV]: '/ignored',
      }),
    ).toEqual({ target: '/elsewhere', syncPrivate: false })
  })

  test('rejects an unknown argument and a target with no value', () => {
    expect(() => parseArgs(['--pull'], {})).toThrow(/Unknown argument/u)
    expect(() => parseArgs(['--target'], {})).toThrow(/requires a value/u)
  })
})

test('the target branch is main', () => {
  expect(TARGET_BRANCH).toBe('main')
})

test('isDirty treats only non-empty porcelain output as dirty', () => {
  expect(isDirty('')).toBe(false)
  expect(isDirty('\n')).toBe(false)
  expect(isDirty(' M src/App.tsx\n')).toBe(true)
})

test('describeResult prefixes a repository line with its outcome', () => {
  expect(describeResult({ label: 'public', status: 'updated', detail: 'main at abc' })).toBe(
    '+ public: main at abc',
  )
  expect(describeResult({ label: 'public', status: 'failed', detail: 'nope' })).toBe(
    'x public: nope',
  )
})

describe('syncRepository', () => {
  test('skips a directory that is not a Git repository', () => {
    const result = syncRepository(tempDir(), 'companion')
    expect(result.status).toBe('skipped')
    expect(result.detail).toMatch(/no Git repository/u)
  })

  test('fast-forwards main and reports the new public commits', () => {
    const { origin, clone } = repoPair()
    pushCommit(origin, 'two')

    const result = syncRepository(clone, 'clone')
    expect(result.status).toBe('updated')
    expect(result.detail).toContain('main now at')
    expect(result.detail).toContain('1 new commit(s)')
    expect(git(clone, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('main')
  })

  test('switches back to main before fast-forwarding', () => {
    const { origin, clone } = repoPair()
    git(clone, 'checkout', '-b', 'feature/thing')
    pushCommit(origin, 'three')

    const result = syncRepository(clone, 'clone')
    expect(result.status).toBe('updated')
    expect(result.detail).toContain('was on feature/thing')
    expect(git(clone, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('main')
  })

  test('reports an already-current repository without claiming an update', () => {
    const { clone } = repoPair()
    const result = syncRepository(clone, 'clone')
    expect(result.status).toBe('current')
    expect(result.detail).toContain('already up to date')
  })

  test('refuses uncommitted changes and leaves the branch alone', () => {
    const { origin, clone } = repoPair()
    git(clone, 'checkout', '-b', 'feature/thing')
    writeFileSync(path.join(clone, 'README.md'), 'edited\n')
    pushCommit(origin, 'four')

    const result = syncRepository(clone, 'clone')
    expect(result.status).toBe('failed')
    expect(result.detail).toMatch(/uncommitted changes/u)
    expect(git(clone, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe('feature/thing')
  })

  test('fails rather than merging a divergent main branch', () => {
    const { origin, clone } = repoPair()
    writeFileSync(path.join(clone, 'local.txt'), 'local\n')
    git(clone, 'add', '.')
    git(clone, 'commit', '-m', 'local only')
    pushCommit(origin, 'five')

    const result = syncRepository(clone, 'clone')
    expect(result.status).toBe('failed')
    expect(git(clone, 'log', '--oneline', '-1')).toContain('local only')
  })

  test('does not expose private revisions or raw Git errors', () => {
    const { clone } = repoPair()
    const current = syncRepository(clone, 'private companion', { sensitive: true })
    expect(current.detail).toBe('main already up to date')

    const failed = syncRepository(clone, 'private companion', {
      sensitive: true,
      git: () => ({ status: 1, stdout: '', stderr: 'secret remote URL' }),
    })
    expect(failed.detail).toBe('git status failed; inspect it locally')
    expect(failed.detail).not.toContain('secret remote URL')
  })
})
