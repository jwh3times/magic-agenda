import { describe, expect, it } from 'vitest'
import { resolveBuildInfo, type BuildFacts } from './build-info'

const SHA = 'a37c862f0e5d4c3b2a19087f6e5d4c3b2a190871'
const facts = (overrides: Partial<BuildFacts> = {}): BuildFacts => ({
  packageVersion: '1.17.0',
  sha: SHA,
  branch: 'main',
  shallow: false,
  tags: ['v1.17.20', 'v1.17.21', 'v1.16.9', 'v1.1.1.3'],
  tagsAtHead: [],
  ...overrides,
})

describe('resolveBuildInfo', () => {
  it('names the version this main build will be tagged with, before the tag exists', () => {
    expect(resolveBuildInfo(facts())).toEqual({ version: '1.17.22', commit: 'a37c862' })
  })

  it('uses the tag already on this commit instead of counting past it', () => {
    // The Version workflow can push the tag before the deploy build runs. Counting from the
    // highest tag would then name the *next* release, one too many.
    const info = resolveBuildInfo(
      facts({ tags: ['v1.17.21', 'v1.17.22'], tagsAtHead: ['v1.17.22'] }),
    )
    expect(info.version).toBe('1.17.22')
  })

  it('claims no version off main: a branch or preview build has none', () => {
    expect(resolveBuildInfo(facts({ branch: 'fix/something' }))).toEqual({
      version: null,
      commit: 'a37c862',
    })
    expect(resolveBuildInfo(facts({ branch: null })).version).toBeNull()
  })

  it('claims no version from a shallow clone, whose tag list cannot be trusted', () => {
    // A shallow clone holds only the tags that point into the history it fetched, so the highest
    // one it knows may be stale. A wrong version is worse than none.
    expect(resolveBuildInfo(facts({ shallow: true })).version).toBeNull()
  })

  it('still trusts a tag on the commit itself in a shallow clone', () => {
    const info = resolveBuildInfo(facts({ shallow: true, tagsAtHead: ['v1.17.22'] }))
    expect(info.version).toBe('1.17.22')
  })

  it('claims no version when the line has no tag at all', () => {
    expect(resolveBuildInfo(facts({ tags: ['v1.16.9'] })).version).toBeNull()
  })

  it('ignores a tag on the commit from another line or the legacy four-part scheme', () => {
    const info = resolveBuildInfo(facts({ tagsAtHead: ['v1.16.9', 'v1.17.21.4', 'nightly'] }))
    expect(info.version).toBe('1.17.22')
  })

  it('reports nothing it does not know', () => {
    expect(resolveBuildInfo(facts({ sha: null, branch: null }))).toEqual({
      version: null,
      commit: null,
    })
    expect(resolveBuildInfo(facts({ sha: 'not-a-sha' })).commit).toBeNull()
    expect(resolveBuildInfo(facts({ packageVersion: 'garbage' })).version).toBeNull()
  })
})
