#!/usr/bin/env node
// Single source of truth for "what version will the next merge to main mint?".
//
// Every merge to main auto-tags v<major>.<minor>.<build>, where the build
// auto-increments per major/minor line and a brand-new line may start at x.y.0
// (see .github/workflows/version.yml). This module reproduces that computation so
// the tag workflow, the CHANGELOG guard (ci.yml), and the ship skill all agree on
// the number. Prints a bare SemVer with no leading "v" (e.g. "1.2.11").

import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import process from 'node:process'

/**
 * Compute the version the next merge will mint for `version`'s major/minor line.
 *
 * @param {string} version - package.json version, "major.minor.build".
 * @param {string[]} tags - all git tag names, e.g. ["v1.2.0", "v1.2.10", "v1.1.1.3"].
 * @returns {string} bare SemVer, e.g. "1.2.11".
 */
export function computeNextVersion(version, tags) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(version).trim())
  if (!m) {
    throw new Error(`package.json version "${version}" is not a plain major.minor.build semver`)
  }
  const [, major, minor, build] = m
  const requested = Number(build)

  // Highest existing 3-part build on this major/minor line. Legacy 4-part tags
  // (e.g. v1.1.1.3) never match this pattern, so they can't perturb the count.
  const onLine = new RegExp(`^v${major}\\.${minor}\\.(\\d+)$`)
  let highest = -1
  for (const tag of tags) {
    const t = onLine.exec(tag.trim())
    if (t) highest = Math.max(highest, Number(t[1]))
  }

  // No tag yet on this line -> release the requested build as-is (allows x.y.0).
  // Otherwise take the next build, unless package.json already jumped further ahead.
  const nextBuild = highest === -1 ? requested : Math.max(requested, highest + 1)
  return `${major}.${minor}.${nextBuild}`
}

/** @returns {string[]} every tag name in the repo. */
export function gitTags() {
  return execFileSync('git', ['tag', '--list'], { encoding: 'utf8' }).split('\n').filter(Boolean)
}

function main() {
  const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  process.stdout.write(computeNextVersion(version, gitTags()) + '\n')
}

// Run main() only when executed directly (`node scripts/next-version.mjs`),
// not when imported by the test.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
