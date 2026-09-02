#!/usr/bin/env node
/**
 * Bring this checkout and its private companion to the latest origin/main.
 *
 * Usage:
 *
 *   npm run sync:main
 *   npm run sync:main -- --skip-private
 *   npm run sync:main -- --target ../magic-agenda-private
 *
 * Per repository, this fetches origin, checks out main, and fast-forwards it
 * to origin/main. It refuses uncommitted changes and divergent branches rather
 * than stashing work or creating a merge commit.
 *
 * A missing companion is reported and skipped because a fresh checkout may
 * legitimately have none until `npm run bootstrap:private` runs. Companion
 * results never print a revision or raw Git error: its operating policy keeps
 * private repository metadata out of public logs.
 */

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const TARGET_BRANCH = 'main'
export const DEFAULT_TARGET = 'private'
export const PRIVATE_ROOT_ENV = 'MAGIC_AGENDA_PRIVATE_ROOT'

export function parseArgs(argv, env = process.env) {
  const options = {
    target: env[PRIVATE_ROOT_ENV]?.trim() || DEFAULT_TARGET,
    syncPrivate: true,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--skip-private') {
      options.syncPrivate = false
      continue
    }
    if (argument !== '--target') throw new Error(`Unknown argument: ${argument}`)
    const value = argv[index + 1]
    if (!value) throw new Error(`${argument} requires a value.`)
    options.target = value
    index += 1
  }

  return options
}

/** `git status --porcelain` prints nothing at all for a clean tree. */
export function isDirty(porcelain) {
  return porcelain.trim().length > 0
}

const MARKS = {
  updated: '+',
  current: '=',
  skipped: '-',
  failed: 'x',
}

export function describeResult(result) {
  return `${MARKS[result.status]} ${result.label}: ${result.detail}`
}

export function runGit(root, args) {
  const result = spawnSync('git', [...args], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  })
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

/** The first non-empty line of Git's complaint, for a one-line public report. */
function firstLine(value) {
  const line = value
    .split('\n')
    .map((part) => part.trim())
    .find((part) => part.length > 0)
  return line ?? 'no output'
}

/**
 * Fetch origin, check out main, and fast-forward one repository.
 *
 * The Git runner is injected so tests can exercise the sequence against local
 * temporary repositories without contacting a network remote.
 */
export function syncRepository(root, label, { sensitive = false, git = runGit } = {}) {
  const fail = (stage, stderr) => ({
    label,
    status: 'failed',
    detail: sensitive ? `${stage}; inspect it locally` : firstLine(stderr),
  })

  if (!existsSync(path.join(root, '.git'))) {
    return { label, status: 'skipped', detail: `no Git repository at ${root}` }
  }

  const status = git(root, ['status', '--porcelain'])
  if (status.status !== 0) return fail('git status failed', status.stderr)
  if (isDirty(status.stdout)) {
    return {
      label,
      status: 'failed',
      detail: 'uncommitted changes; commit or stash them, then run this again',
    }
  }

  const fetch = git(root, ['fetch', '--prune', 'origin'])
  if (fetch.status !== 0) return fail('fetch from origin failed', fetch.stderr)

  const previousBranch = git(root, ['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim()
  const before = git(root, ['rev-parse', 'HEAD']).stdout.trim()

  if (previousBranch !== TARGET_BRANCH) {
    const checkout = git(root, ['checkout', TARGET_BRANCH])
    if (checkout.status !== 0) return fail(`checkout ${TARGET_BRANCH} failed`, checkout.stderr)
  }

  const merge = git(root, ['merge', '--ff-only', `origin/${TARGET_BRANCH}`])
  if (merge.status !== 0) {
    return fail(`fast-forward from origin/${TARGET_BRANCH} failed`, merge.stderr)
  }

  const after = git(root, ['rev-parse', 'HEAD']).stdout.trim()
  const switched = previousBranch === TARGET_BRANCH ? '' : ` (was on ${previousBranch})`

  if (sensitive) {
    return before === after
      ? { label, status: 'current', detail: `${TARGET_BRANCH} already up to date` }
      : { label, status: 'updated', detail: `${TARGET_BRANCH} fast-forwarded from origin` }
  }

  if (before === after) {
    return {
      label,
      status: 'current',
      detail: `${TARGET_BRANCH} already up to date at ${after.slice(0, 7)}${switched}`,
    }
  }

  const count = git(root, ['rev-list', '--count', `${before}..${after}`]).stdout.trim()
  const commits = count && count !== '0' ? `, ${count} new commit(s)` : ''
  return {
    label,
    status: 'updated',
    detail: `${TARGET_BRANCH} now at ${after.slice(0, 7)}${commits}${switched}`,
  }
}

export function main(argv) {
  const options = parseArgs(argv)
  const worktreeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const results = [syncRepository(worktreeRoot, 'magic-agenda')]

  if (options.syncPrivate) {
    const companionRoot = path.resolve(worktreeRoot, options.target)
    if (existsSync(path.join(companionRoot, '.git'))) {
      results.push(syncRepository(companionRoot, 'private companion', { sensitive: true }))
    } else {
      results.push({
        label: 'private companion',
        status: 'skipped',
        detail: `not installed at ${companionRoot}; run \`npm run bootstrap:private\``,
      })
    }
  }

  for (const result of results) console.log(describeResult(result))
  return results.some((result) => result.status === 'failed') ? 1 : 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exit(main(process.argv.slice(2)))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
