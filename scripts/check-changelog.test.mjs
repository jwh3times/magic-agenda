import { describe, it, expect } from 'vitest'
import { checkChangelog, documentedVersions, releasedVersions } from './check-changelog.mjs'

const changelog = `# Changelog

## [Unreleased]

No unreleased changes.

## [1.2.12] - 2026-07-16

### Internal

- A thing.

## [1.2.11] - 2026-07-16

### Internal

- Another thing.
`

describe('releasedVersions', () => {
  it('takes 3-part tags and drops the leading v', () => {
    expect(releasedVersions(['v1.2.0', 'v1.2.11'])).toEqual(['1.2.0', '1.2.11'])
  })

  it('ignores legacy 4-part tags', () => {
    expect(releasedVersions(['v1.1.1.29', 'v1.2.0'])).toEqual(['1.2.0'])
  })

  it('ignores tags that are not releases', () => {
    expect(releasedVersions(['nightly', 'v1.2.0-rc1', 'v1.2.0'])).toEqual(['1.2.0'])
  })
})

describe('documentedVersions', () => {
  it('finds each versioned section', () => {
    expect(documentedVersions(changelog)).toEqual(['1.2.12', '1.2.11'])
  })

  it('does not count [Unreleased] as a version', () => {
    expect(documentedVersions('## [Unreleased]\n')).toEqual([])
  })

  it('only matches headings at the start of a line', () => {
    expect(documentedVersions('see the `## [9.9.9]` section\n')).toEqual([])
  })
})

describe('checkChangelog', () => {
  const tags = ['v1.2.11']

  it('passes when the target version is named and nothing is missing', () => {
    expect(checkChangelog(changelog, tags, '1.2.12')).toEqual({ namesNext: true, missing: [] })
  })

  it('fails when the changelog does not name the version this merge mints', () => {
    expect(checkChangelog(changelog, tags, '1.2.13')).toEqual({ namesNext: false, missing: [] })
  })

  it('reports a released build with no section (an undocumented Dependabot merge)', () => {
    const { missing } = checkChangelog(changelog, ['v1.2.11', 'v1.2.13'], '1.2.14')
    expect(missing).toEqual(['1.2.13'])
  })

  it('reports missing builds oldest first, not lexicographically', () => {
    const { missing } = checkChangelog(changelog, ['v1.2.13', 'v1.2.9', 'v1.3.0'], '1.3.1')
    expect(missing).toEqual(['1.2.9', '1.2.13', '1.3.0'])
  })

  it('does not report the target version as missing (it is not tagged yet)', () => {
    expect(checkChangelog(changelog, tags, '1.2.12').missing).toEqual([])
  })

  it('catches both problems at once', () => {
    expect(checkChangelog(changelog, ['v1.2.11', 'v1.2.13'], '1.2.99')).toEqual({
      namesNext: false,
      missing: ['1.2.13'],
    })
  })
})
