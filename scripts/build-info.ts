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
  tags: string[]
  tagsAtHead: string[]
  /**
   * Whether `tags` is every tag there is. False for a shallow clone, which knows only the tags
   * inside the history it fetched, and Cloudflare Pages builds from one.
   */
  tagsComplete: boolean
  /** Whether this commit is the tip of the release branch, so the next tag minted is its own. */
  headIsTip: boolean
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
  // Counting on is only right for the newest commit with every tag in view. An older commit still
  // waiting for its tag would be given a later release's number. And no tag on the line means the
  // tags were not fetched, not that this is the line's first release: computeNextVersion would
  // answer x.y.0 with full confidence.
  if (!facts.tagsComplete || !facts.headIsTip || builds(facts.tags).length === 0) return null
  return computeNextVersion(facts.packageVersion, facts.tags)
}

/**
 * Read `git ls-remote` output: every tag, the tags on `sha`, and whether `sha` is the branch tip.
 *
 * An annotated tag is listed twice, once as the tag object and once peeled (`^{}`) to the commit
 * it names. Release tags are annotated, so the peeled line is the one that can match a commit; a
 * lightweight tag has only the plain line, which already names the commit.
 */
export function parseRemoteRefs(
  output: string,
  sha: string | null,
): Pick<BuildFacts, 'tags' | 'tagsAtHead' | 'headIsTip'> {
  const tags = new Set<string>()
  const tagsAtHead = new Set<string>()
  let headIsTip = false
  for (const line of output.split('\n')) {
    const [object, ref] = line.trim().split(/\s+/)
    if (!object || !ref) continue
    if (ref === `refs/heads/${RELEASE_BRANCH}`) {
      headIsTip = object === sha
    } else if (ref.startsWith('refs/tags/')) {
      const tag = ref.slice('refs/tags/'.length).replace(/\^\{\}$/, '')
      tags.add(tag)
      if (object === sha) tagsAtHead.add(tag)
    }
  }
  return { tags: [...tags], tagsAtHead: [...tagsAtHead], headIsTip }
}

function git(...args: string[]): string | null {
  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 15_000,
    }).trim()
  } catch {
    return null
  }
}

const lines = (output: string | null) => (output ?? '').split('\n').filter(Boolean)

/** Public, so `ls-remote` needs no credential; used when the checkout has no `origin`. */
const REPOSITORY = 'https://github.com/jwh3times/magic-agenda.git'

/**
 * Cloudflare Pages checks a commit out detached, so its branch comes from the environment; the
 * same is true of the commit, which is also cheaper to trust than to ask git for.
 *
 * **Its clone is shallow and carries no tags** (measured on the first production build, v1.17.23,
 * which showed a commit and no version). So a Pages build of the release branch asks the remote
 * for its tags and branch tip instead. Only there: a local build should not need the network, and
 * a developer's clone has the tags.
 */
export function readBuildFacts(env: NodeJS.ProcessEnv = process.env): BuildFacts {
  const { version } = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  ) as { version: string }
  const head = git('rev-parse', '--abbrev-ref', 'HEAD')
  const branch = env.CF_PAGES_BRANCH || (head === 'HEAD' ? null : head)
  const sha = env.CF_PAGES_COMMIT_SHA || git('rev-parse', 'HEAD')
  const base = { packageVersion: version, sha, branch }

  if (env.CF_PAGES && branch === RELEASE_BRANCH) {
    const refs = ['refs/tags/v*', `refs/heads/${RELEASE_BRANCH}`]
    const remote = git('ls-remote', 'origin', ...refs) ?? git('ls-remote', REPOSITORY, ...refs)
    if (remote) return { ...base, ...parseRemoteRefs(remote, sha), tagsComplete: true }
  }
  return {
    ...base,
    tags: lines(git('tag', '--list')),
    tagsAtHead: lines(git('tag', '--points-at', 'HEAD')),
    tagsComplete: git('rev-parse', '--is-shallow-repository') === 'false',
    // Unknown without asking the remote. A local build of a release is on its tagged commit,
    // which the tag-on-this-commit rule already answers.
    headIsTip: false,
  }
}
