import { describe, expect, it } from 'vitest'
import { hoverRetry, retryWarnings } from './hover-retry'

const WORKSPACE = '/home/runner/work/magic-agenda/magic-agenda'

const finished = (annotations: { type: string; description?: string }[]) => ({
  title: 'cancelling a drag (#583) › Escape after a hover move puts the Task back (week)',
  file: `${WORKSPACE}/tests/e2e/smoke.spec.ts`,
  line: 179,
  annotations,
})

describe('retryWarnings', () => {
  it('turns a hover retry into one GitHub warning naming the test, the lane and the attempts', () => {
    const lines = retryWarnings(finished([hoverRetry("today's Week column", 2)]), WORKSPACE)

    expect(lines).toEqual([
      '::warning file=tests/e2e/smoke.spec.ts,line=179,title=Hover retry (#586)::' +
        "cancelling a drag (#583) › Escape after a hover move puts the Task back (week): the hover onto today's Week column took 2 attempts",
    ])
  })

  it('escapes what GitHub would otherwise read as part of the command', () => {
    const [line] = retryWarnings(finished([hoverRetry('a 100% wide\r\nlane', 3)]), WORKSPACE)

    expect(line).toMatch(/::.*: the hover onto a 100%25 wide%0D%0Alane took 3 attempts$/)
    expect(line).not.toMatch(/[\r\n]/)
  })

  it('says nothing for a test whose hover worked first time, whatever else it recorded', () => {
    expect(retryWarnings(finished([]), WORKSPACE)).toEqual([])
    expect(retryWarnings(finished([{ type: 'issue', description: '#595' }]), WORKSPACE)).toEqual([])
  })
})
