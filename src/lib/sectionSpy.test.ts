import { describe, expect, it } from 'vitest'
import { currentSection, SPY_LINE } from './sectionSpy'

const IDS = ['appearance', 'dates', 'keyboard', 'notifications', 'boards']

describe('currentSection', () => {
  it('is the first section before any has reached the line', () => {
    expect(currentSection(IDS, [120, 400, 700, 900, 1200], { atBottom: false })).toBe('appearance')
  })

  it('is the last section whose top has reached the line', () => {
    expect(currentSection(IDS, [-900, -500, 20, 300, 700], { atBottom: false })).toBe('keyboard')
  })

  // The #464 regression: a nav jump lands a section 28px from the top, and a short section leaves
  // the next heading only ~150px down. A line a third of the way down a 1440p window (~360px) had
  // already been crossed by that next heading, so the nav highlighted the section after the one
  // the user chose.
  it('keeps a short section current when the next heading is close below it', () => {
    const tops = [-600, -300, 28, 28 + 120 + 16, 600]
    expect(currentSection(IDS, tops, { atBottom: false })).toBe('keyboard')
  })

  it('switches exactly when the next heading reaches the line', () => {
    expect(currentSection(IDS, [-600, -300, -80, SPY_LINE, 600], { atBottom: false })).toBe(
      'notifications',
    )
    expect(currentSection(IDS, [-600, -300, -80, SPY_LINE + 1, 600], { atBottom: false })).toBe(
      'keyboard',
    )
  })

  it('is the last section at the bottom of the page, which a short one can never reach the line from', () => {
    expect(currentSection(IDS, [-900, -600, -300, 100, 500], { atBottom: true })).toBe('boards')
  })

  it('skips a section that is not on the page', () => {
    expect(currentSection(IDS, [-900, null, -300, null, 700], { atBottom: false })).toBe('keyboard')
  })
})
