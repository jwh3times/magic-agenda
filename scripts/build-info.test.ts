import { describe, expect, it } from 'vitest'
import { parseRemoteRefs, resolveBuildInfo, type BuildFacts } from './build-info'

const SHA = 'a37c862f0e5d4c3b2a19087f6e5d4c3b2a190871'
const facts = (overrides: Partial<BuildFacts> = {}): BuildFacts => ({
  packageVersion: '1.17.0',
  sha: SHA,
  branch: 'main',
  tags: ['v1.17.20', 'v1.17.21', 'v1.16.9', 'v1.1.1.3'],
  tagsAtHead: [],
  tagsComplete: true,
  headIsTip: true,
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

  it('claims no version from an incomplete tag list, which a shallow clone has', () => {
    // A shallow clone holds only the tags that point into the history it fetched, so the highest
    // one it knows may be stale. A wrong version is worse than none.
    expect(resolveBuildInfo(facts({ tagsComplete: false })).version).toBeNull()
  })

  it('still trusts a tag on the commit itself when the list is incomplete', () => {
    const info = resolveBuildInfo(facts({ tagsComplete: false, tagsAtHead: ['v1.17.22'] }))
    expect(info.version).toBe('1.17.22')
  })

  it('does not count on for a commit that is no longer the newest', () => {
    // Two merges in quick succession: the older one is built while still untagged, after the
    // newer one has its tag. Counting on would give the older commit a third release's number.
    expect(resolveBuildInfo(facts({ headIsTip: false })).version).toBeNull()
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

describe('parseRemoteRefs', () => {
  const OTHER = 'b'.repeat(40)
  const TAG_OBJECT = 'c'.repeat(40)
  const listing = [
    `${TAG_OBJECT}\trefs/tags/v1.17.22`,
    `${SHA}\trefs/tags/v1.17.22^{}`,
    `${OTHER}\trefs/tags/v1.17.21`,
    `${OTHER}\trefs/tags/v1.17.21^{}`,
    `${SHA}\trefs/heads/main`,
  ].join('\n')

  it('lists each tag once and finds the annotated tag that peels to this commit', () => {
    const refs = parseRemoteRefs(listing, SHA)
    expect(refs.tags.sort()).toEqual(['v1.17.21', 'v1.17.22'])
    expect(refs.tagsAtHead).toEqual(['v1.17.22'])
    expect(refs.headIsTip).toBe(true)
  })

  it('knows when the commit is behind the branch tip', () => {
    const refs = parseRemoteRefs(listing, OTHER)
    expect(refs.headIsTip).toBe(false)
    expect(refs.tagsAtHead).toEqual(['v1.17.21'])
  })

  it('matches a lightweight tag, which has no peeled line', () => {
    expect(parseRemoteRefs(`${SHA}\trefs/tags/v1.17.30\n`, SHA).tagsAtHead).toEqual(['v1.17.30'])
  })

  it('reads an empty listing as knowing nothing', () => {
    expect(parseRemoteRefs('', SHA)).toEqual({ tags: [], tagsAtHead: [], headIsTip: false })
  })

  it('feeds the resolver: the tip with no tag yet is the next build', () => {
    const untagged = `${OTHER}\trefs/tags/v1.17.21^{}\n${SHA}\trefs/heads/main`
    const info = resolveBuildInfo(facts({ ...parseRemoteRefs(untagged, SHA), tagsComplete: true }))
    expect(info.version).toBe('1.17.22')
  })
})
