#!/usr/bin/env node
/**
 * Install the private companion repository at `private/`.
 *
 * `private/` is git-ignored here and is a separate private Git repository (see AGENTS.md, "Dated
 * security reviews"). On a fresh checkout or worktree it does not exist, and nothing in this
 * public repository may name its remote directly. So the clone URL is resolved at run time from
 * 1Password through the CLI (`op read`), which also means the maintainer's own 1Password access
 * is the only thing that can produce a clone -- there is no second credential to leak.
 *
 *   npm run bootstrap:private
 *   npm run bootstrap:private -- --url <clone-url>            # bypass 1Password
 *   npm run bootstrap:private -- --op-reference op://...      # a different secret reference
 *
 * Three refusals are deliberate and are the reason this is a script rather than a README line:
 *
 *  - The URL must be a credential-free github.com HTTPS or SSH URL. `op read` returns whatever
 *    the field holds; an embedded token would otherwise end up in `.git/config`.
 *  - GitHub must report the repository as PRIVATE *before* the clone. A companion repo that has
 *    been flipped public is a disclosure, and continuing to work in it as if it were private
 *    is how the next push makes it worse. This check needs an authenticated `gh`.
 *  - A non-empty `private/` that is not a Git worktree is never overwritten. It is the only copy
 *    of whatever is in it.
 *
 * If the companion is already installed, the script fast-forwards it and reports its state
 * instead -- the same start-of-session check `private/OPERATING-POLICY.md` asks for.
 */
import { existsSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** Where the clone URL lives. A URL field, not a credential; resolving it needs vault access. */
export const DEFAULT_OP_REFERENCE =
  'op://magic-agenda/tmsgwvzi7vn4h4xgo6ah74bfpi/PRIVATE_REPOSITORY_URL'

/** Optional `op://` reference to a 1Password service-account token used only as a fallback. */
export const SERVICE_ACCOUNT_REFERENCE_ENV = 'MAGIC_AGENDA_OP_SERVICE_ACCOUNT_REFERENCE'

const SSH_RE = /^git@github\.com:([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/u

/**
 * Validate a clone URL and extract its `owner/name` slug.
 *
 * Returns `{ ok: true, url, slug }` or `{ ok: false, reason }`. Pure, so it is unit-tested; the
 * rules are the two refusals above plus "one line" (an `op read` of a multi-line field would
 * otherwise be handed to `git clone` verbatim).
 */
export function validateCloneUrl(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return { ok: false, reason: 'The clone URL is empty.' }
  }
  const url = raw.trim()
  if (/[\r\n]/u.test(url)) return { ok: false, reason: 'The clone URL must be a single line.' }

  if (/^https?:\/\//iu.test(url)) {
    let parsed
    try {
      parsed = new URL(url)
    } catch {
      return { ok: false, reason: 'The HTTPS clone URL does not parse.' }
    }
    if (parsed.protocol !== 'https:') {
      return { ok: false, reason: 'The clone URL must use https, not http.' }
    }
    if (parsed.hostname.toLowerCase() !== 'github.com') {
      return { ok: false, reason: 'The HTTPS clone URL must target github.com.' }
    }
    if (parsed.username || parsed.password) {
      return { ok: false, reason: 'The HTTPS clone URL must not embed a credential.' }
    }
    const match = parsed.pathname.match(/^\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/u)
    if (!match) return { ok: false, reason: 'The HTTPS clone URL must be github.com/<owner>/<repo>.' }
    return { ok: true, url, slug: `${match[1]}/${match[2]}` }
  }

  const match = url.match(SSH_RE)
  if (!match) {
    return {
      ok: false,
      reason: 'The clone URL must be a credential-free GitHub HTTPS or SSH URL.',
    }
  }
  return { ok: true, url, slug: `${match[1]}/${match[2]}` }
}

/** Parse `gh repo view --json visibility` output. Anything but an explicit PRIVATE is a refusal. */
export function isReportedPrivate(json) {
  try {
    return JSON.parse(json)?.visibility === 'PRIVATE'
  } catch {
    return false
  }
}

function parseArgs(argv) {
  const opts = {
    url: null,
    reference: DEFAULT_OP_REFERENCE,
    serviceAccountReference: process.env[SERVICE_ACCOUNT_REFERENCE_ENV] ?? null,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const value = argv[i + 1]
    if (!['--url', '--op-reference', '--service-account-reference'].includes(arg)) {
      throw new Error(`Unknown argument: ${arg}`)
    }
    if (!value) throw new Error(`${arg} requires a value.`)
    if (arg === '--url') opts.url = value
    else if (arg === '--op-reference') opts.reference = value
    else opts.serviceAccountReference = value
    i += 1
  }
  return opts
}

function run(cmd, args, extra = {}) {
  return spawnSync(cmd, args, { encoding: 'utf8', windowsHide: true, ...extra })
}

function opRead(reference, env = process.env) {
  const result = run('op', ['read', '--no-newline', reference], { env })
  return result.status === 0 ? result.stdout.trim() : ''
}

/** Resolve the clone URL from 1Password, falling back to a service-account token if configured. */
function resolveCloneUrl({ reference, serviceAccountReference }) {
  let url = opRead(reference)
  if (!url && serviceAccountReference) {
    const token = opRead(serviceAccountReference)
    if (token) {
      // The token exists only in this child's environment; nothing here prints or persists it.
      url = opRead(reference, { ...process.env, OP_SERVICE_ACCOUNT_TOKEN: token })
    }
  }
  if (!url) {
    throw new Error(
      `Could not read ${reference} with the current 1Password identity` +
        (serviceAccountReference ? ' or the service-account fallback.' : '.') +
        ' Run `op signin` (or `op whoami` to see who you are) and try again,' +
        ' or pass --url explicitly.',
    )
  }
  return url
}

function assertPrivate(slug) {
  const view = run('gh', ['repo', 'view', slug, '--json', 'nameWithOwner,visibility'])
  if (view.status !== 0) {
    throw new Error(
      `Could not confirm ${slug} is private: \`gh repo view\` failed. ` +
        'Authenticate with `gh auth login` first; the visibility check is not optional.',
    )
  }
  if (!isReportedPrivate(view.stdout)) {
    throw new Error(
      `GitHub does not report ${slug} as PRIVATE. Stop: do not clone or push it until its ` +
        'visibility is corrected (see private/OPERATING-POLICY.md, "Repository reported public").',
    )
  }
}

function reportInstalled(privateRoot) {
  const fetch = run('git', ['-C', privateRoot, 'fetch', '--quiet', 'origin'])
  if (fetch.status !== 0) {
    console.log('The private companion is already installed (fetch failed; offline?).')
    return
  }
  const counts = run('git', [
    '-C',
    privateRoot,
    'rev-list',
    '--left-right',
    '--count',
    'origin/main...main',
  ])
  const [behind = '?', ahead = '?'] = counts.stdout.trim().split(/\s+/u)
  const dirty = run('git', ['-C', privateRoot, 'status', '--porcelain']).stdout.trim() !== ''
  if (Number(behind) > 0 && Number(ahead) === 0 && !dirty) {
    const pull = run('git', ['-C', privateRoot, 'pull', '--ff-only', '--quiet'], {
      stdio: 'inherit',
    })
    console.log(
      pull.status === 0
        ? `The private companion was behind by ${behind}; fast-forwarded.`
        : 'The private companion is behind and could not be fast-forwarded. Review it by hand.',
    )
    return
  }
  console.log(
    `The private companion is already installed: ahead ${ahead}, behind ${behind}` +
      `${dirty ? ', with uncommitted changes' : ''}.` +
      (Number(ahead) > 0 || dirty ? ' Review, then commit and push it per OPERATING-POLICY.md.' : ''),
  )
}

export function main(argv) {
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const privateRoot = join(repositoryRoot, 'private')
  const opts = parseArgs(argv)

  if (existsSync(join(privateRoot, '.git'))) {
    reportInstalled(privateRoot)
    return
  }
  if (existsSync(privateRoot) && readdirSync(privateRoot).length > 0) {
    throw new Error(
      'Refusing to overwrite a non-empty private/ that is not a Git worktree. ' +
        'It may be the only copy of what it holds: move it aside yourself if it is stale.',
    )
  }

  const validated = validateCloneUrl(opts.url ?? resolveCloneUrl(opts))
  if (!validated.ok) throw new Error(validated.reason)

  assertPrivate(validated.slug)

  const clone = run('git', ['clone', validated.url, privateRoot], { stdio: 'inherit' })
  if (clone.status !== 0 || !existsSync(join(privateRoot, '.git'))) {
    throw new Error('The private companion clone did not complete successfully.')
  }

  const ignored = run('git', ['-C', repositoryRoot, 'check-ignore', '-q', 'private/README.md'])
  if (ignored.status !== 0) {
    console.error(
      'WARNING: the public repository does NOT ignore private/. Do not stage anything until ' +
        '.gitignore carries its `private/` rule again.',
    )
  }
  console.log(`Private companion installed at private/ (${validated.slug}, verified PRIVATE).`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
