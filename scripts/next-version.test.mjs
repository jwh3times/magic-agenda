import { describe, it, expect } from 'vitest'
import { computeNextVersion } from './next-version.mjs'

describe('computeNextVersion', () => {
  it('increments the build from the highest existing tag on the line', () => {
    const tags = ['v1.0.0', 'v1.2.0', 'v1.2.1', 'v1.2.10', 'v1.1.0']
    expect(computeNextVersion('1.2.0', tags)).toBe('1.2.11')
  })

  it('ignores legacy 4-part tags on the same numeric prefix', () => {
    const tags = ['v1.2.0', 'v1.1.1.29', 'v1.1.1.3']
    expect(computeNextVersion('1.2.0', tags)).toBe('1.2.1')
  })

  it('releases a brand-new major/minor line at its requested build (x.y.0 stays x.y.0)', () => {
    const tags = ['v1.2.0', 'v1.2.10']
    expect(computeNextVersion('1.3.0', tags)).toBe('1.3.0')
  })

  it('honors a package.json build that jumps past the auto-increment', () => {
    const tags = ['v1.2.0', 'v1.2.1']
    expect(computeNextVersion('1.2.5', tags)).toBe('1.2.5')
  })

  it('takes the auto-increment when package.json trails the tags', () => {
    const tags = ['v1.2.0', 'v1.2.9']
    expect(computeNextVersion('1.2.0', tags)).toBe('1.2.10')
  })

  it('is not fooled by another line sharing a numeric prefix (v12.x vs v1.2.x)', () => {
    const tags = ['v1.2.0', 'v12.0.0', 'v12.0.5']
    expect(computeNextVersion('1.2.0', tags)).toBe('1.2.1')
  })

  it('rejects a version that is not plain major.minor.build', () => {
    expect(() => computeNextVersion('1.2', [])).toThrow()
    expect(() => computeNextVersion('1.2.0-rc1', [])).toThrow()
  })
})
