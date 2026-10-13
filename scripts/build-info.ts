import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import process from 'node:process'
import { computeNextVersion } from './next-version.mjs'

/**
 * Which release a bundle is, resolved while it is built and shown in Settings.
 *
 * The version is not in the source: `package.json` carries only the major/minor line, and the
 * build number is a tag the `Version` workflow pushes after the merge. Cloudflare Pages builds the
 * same commit on its own, so the tag may or may not exist yet when this runs. Both cases resolve
 * to the same number, through the script the tag workflow itself uses.
 *
 * **A wrong version is worse than none.** Someone reads this to decide whether a fix is live, so
 * every case that cannot be answered for certain answers `null` and the commit alone is shown.
 */
export interface BuildInfo {
  /** Bare SemVer such as `1.17.22`, or null when this build is not a release or cannot tell. */
  version: string | null
  /** The seven-character commit, or null outside a git checkout. */
  commit: string | null
}

export interface BuildFacts {
  packageVersion: string
  sha: string | null
  branch: string | null
  /** A shallow clone knows only the tags inside the history it fetched. */
  shallow: boolean
  tags: string[]
  tagsAtHead: string[]
}

const RELEASE_BRANCH = 'main'

export function resolveBuildInfo(facts: BuildFacts): BuildInfo {
  const commit = /^[0-9a-f]{7,40}$/i.test(facts.sha ?? '') ? facts.sha!.slice(0, 7) : null
  return { version: releaseVersion(facts), commit }
}

function releaseVersion(facts: BuildFacts): string | null {
  // Only a merge to main is a release. A branch or a Pages preview has no version of its own, and
  // naming the one its merge *would* mint reads as "this is that release".
  if (facts.branch !== RELEASE_BRANCH) return null
  const line = /^(\d+)\.(\d+)\.\d+$/.exec(facts.packageVersion.trim())
  if (!line) return null
  const onLine = new RegExp(`^v(${line[1]}\\.${line[2]}\\.(\\d+))$`)
  const builds = (tags: string[]) =>
    tags.flatMap((tag) => {
      const match = onLine.exec(tag.trim())
      return match ? [{ version: match[1], build: Number(match[2]) }] : []
    })

  // The tag workflow may have finished first. Counting on from the highest tag would then name
  // the next release rather than this one.
  const here = builds(facts.tagsAtHead).sort((a, b) => b.build - a.build)[0]
  if (here) return here.version
  // No tag on the line means the tags were not fetched, not that this is the line's first
  // release: computeNextVersion would answer x.y.0 with full confidence.
  if (facts.shallow || builds(facts.tags).length === 0) return null
  return computeNextVersion(facts.packageVersion, facts.tags)
}

function git(...args: string[]): string | null {
  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return null
  }
}

const lines = (output: string | null) => (output ?? '').split('\n').filter(Boolean)

/**
 * Cloudflare Pages checks a commit out detached, so its branch comes from the environment; the
 * same is true of the commit, which is also cheaper to trust than to ask git for.
 */
export function readBuildFacts(env: NodeJS.ProcessEnv = process.env): BuildFacts {
  const { version } = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  ) as { version: string }
  const branch = env.CF_PAGES_BRANCH || git('rev-parse', '--abbrev-ref', 'HEAD')
  return {
    packageVersion: version,
    sha: env.CF_PAGES_COMMIT_SHA || git('rev-parse', 'HEAD'),
    branch: branch === 'HEAD' ? null : branch,
    shallow: git('rev-parse', '--is-shallow-repository') !== 'false',
    tags: lines(git('tag', '--list')),
    tagsAtHead: lines(git('tag', '--points-at', 'HEAD')),
  }
}
