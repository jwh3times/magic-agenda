#!/usr/bin/env node
// Verifies CHANGELOG.md against the release history. Two invariants:
//
//  1. The changelog names the version THIS merge will mint (scripts/next-version.mjs).
//  2. Every build that already shipped has a section.
//
// (2) is what keeps (1)'s Dependabot exemption honest. A bot can't write a
// meaningful entry, so its merges ship undocumented and take a build number with
// them; this fails the next human PR until those gaps are backfilled, instead of
// letting them accumulate silently.
//
// Run by the `Changelog` CI job (.github/workflows/ci.yml) and mirrored locally by
// the ship skill. Exits 0 when the changelog is complete, 1 with a diagnosis if not.

import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import process from 'node:process'
import { computeNextVersion, gitTags } from './next-version.mjs'

/**
 * Builds that have actually been released, i.e. 3-part tags. Legacy 4-part tags
 * (v1.1.1.3) predate the scheme and are not releases under it.
 *
 * @param {string[]} tags - all git tag names.
 * @returns {string[]} bare SemVers, e.g. ["1.2.0", "1.2.11"].
 */
export function releasedVersions(tags) {
  return tags
    .map((tag) => /^v(\d+\.\d+\.\d+)$/.exec(tag.trim()))
    .filter((m) => m !== null)
    .map((m) => m[1])
}

/**
 * Versions with a `## [x.y.z]` section. `## [Unreleased]` is deliberately not one.
 *
 * @param {string} changelog - CHANGELOG.md contents.
 * @returns {string[]} bare SemVers.
 */
export function documentedVersions(changelog) {
  return [...changelog.matchAll(/^## \[(\d+\.\d+\.\d+)\]/gm)].map((m) => m[1])
}

function compareVersions(a, b) {
  const [aMajor, aMinor, aBuild] = a.split('.').map(Number)
  const [bMajor, bMinor, bBuild] = b.split('.').map(Number)
  return aMajor - bMajor || aMinor - bMinor || aBuild - bBuild
}

/**
 * @param {string} changelog - CHANGELOG.md contents.
 * @param {string[]} tags - all git tag names.
 * @param {string} next - the version this merge will mint.
 * @returns {{namesNext: boolean, missing: string[]}} `missing` is released-but-undocumented, oldest first.
 */
export function checkChangelog(changelog, tags, next) {
  const documented = new Set(documentedVersions(changelog))
  return {
    namesNext: documented.has(next),
    missing: releasedVersions(tags)
      .filter((version) => !documented.has(version))
      .sort(compareVersions),
  }
}

function main() {
  const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8')
  const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  const tags = gitTags()
  const next = computeNextVersion(version, tags)
  const { namesNext, missing } = checkChangelog(changelog, tags, next)
  let failed = false

  if (namesNext) {
    process.stdout.write(`CHANGELOG.md names v${next}, the version this merge will mint.\n`)
  } else {
    failed = true
    process.stdout.write(
      `::error file=CHANGELOG.md::This merge releases v${next}, but CHANGELOG.md has no '## [${next}]' section. Add it — run 'node scripts/next-version.mjs' for the number, or let the ship skill do it.\n`,
    )
  }

  if (missing.length === 0) {
    process.stdout.write('Every released build is documented.\n')
  } else {
    failed = true
    process.stdout.write(
      `::error file=CHANGELOG.md::These builds were released but have no '## [x.y.z]' section: ${missing.join(', ')}. They are almost certainly Dependabot merges (exempt from this check, backfilled by the next human PR). Add a section for each from its release tag.\n`,
    )
  }

  process.exit(failed ? 1 : 0)
}

// Run main() only when executed directly, not when imported by the test.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
