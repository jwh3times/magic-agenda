#!/usr/bin/env node
/**
 * Resolve the Cloudflare Pages preview URL for a commit.
 *
 * This repository has NO GitHub Deployments -- Cloudflare Pages reports as a check run whose
 * details_url points at the Cloudflare dashboard, and no GitHub API surfaces the preview URL. So
 * the URL is derived from the deployment UUID embedded in that dashboard link:
 *
 *   details_url  .../pages/view/magic-agenda/15aaf5a2-379b-41c1-a55c-d6a4ece71cef
 *   preview      https://15aaf5a2.magic-agenda.pages.dev
 *
 * Verified against PRs #113, #114 and #115 before adoption. Both the details_url shape and the
 * URL convention are undocumented, so if either changes this returns null and the CLI exits 1
 * with a message -- it never falls back to guessing, and never silently tests production. The
 * recorded escape hatch is the Cloudflare Pages deployments API, which needs an API token.
 */
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

export const CLOUDFLARE_CHECK_NAME = 'Cloudflare Pages'
const PROJECT = 'magic-agenda'
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

export function findCloudflareCheckRun(checkRuns) {
  if (!Array.isArray(checkRuns)) return null
  return checkRuns.find((run) => run?.name === CLOUDFLARE_CHECK_NAME) ?? null
}

export function previewUrlFromDetailsUrl(detailsUrl, project) {
  if (typeof detailsUrl !== 'string') return null
  const match = detailsUrl.match(UUID_RE)
  if (!match) return null
  return `https://${match[0].slice(0, 8).toLowerCase()}.${project}.pages.dev`
}

const POLL_INTERVAL_MS = 15_000
const TIMEOUT_MS = 10 * 60_000

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function main() {
  const sha = process.argv[2]
  const repo = process.env.GITHUB_REPOSITORY
  if (!sha) throw new Error('usage: node scripts/preview-url.mjs <sha>')
  if (!repo) throw new Error('GITHUB_REPOSITORY is unset')

  const deadline = Date.now() + TIMEOUT_MS
  for (;;) {
    const raw = execFileSync('gh', ['api', `repos/${repo}/commits/${sha}/check-runs`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const run = findCloudflareCheckRun(JSON.parse(raw).check_runs)

    if (run?.status === 'completed') {
      if (run.conclusion !== 'success') {
        throw new Error(`Cloudflare Pages build for ${sha} concluded "${run.conclusion}".`)
      }
      const url = previewUrlFromDetailsUrl(run.details_url, PROJECT)
      if (!url) {
        throw new Error(
          `Could not derive a preview URL from details_url: ${run.details_url}\n` +
            'Cloudflare may have changed its dashboard link format. See the header comment in ' +
            'scripts/preview-url.mjs for the Cloudflare API fallback.',
        )
      }
      process.stdout.write(url)
      return
    }

    if (Date.now() >= deadline) {
      throw new Error(
        `No completed Cloudflare Pages deploy appeared for ${sha} within 10 minutes.\n` +
          'The preview may be slow, or Pages may not build for this PR (forks get no preview).',
      )
    }
    await sleep(POLL_INTERVAL_MS)
  }
}

// Only run the CLI when invoked directly, so importing the pure helpers in a test does not poll.
// pathToFileURL, not `new URL('file://' + argv[1])`: the manual form does not percent-encode, so a
// checkout path containing a space or a '%' produces a non-matching href and the CLI silently
// refuses to run. This repo lives under "OneDrive\Documents\..." today, but that is luck.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
