import { describe, it, expect } from 'vitest'
import { claudeMdImportsAgents } from './check-claude-md.mjs'

describe('claudeMdImportsAgents', () => {
  it('accepts the import pointer', () => {
    expect(claudeMdImportsAgents('# CLAUDE.md\n\n@AGENTS.md\n\nSee AGENTS.md.\n')).toBe(true)
  })

  it('accepts CRLF line endings', () => {
    expect(claudeMdImportsAgents('# CLAUDE.md\r\n\r\n@AGENTS.md\r\n')).toBe(true)
  })

  it('rejects a CLAUDE.md that has grown its own copy of the guide', () => {
    expect(claudeMdImportsAgents('# CLAUDE.md\n\n## Commands\n\nnpm run dev\n')).toBe(false)
  })

  it('rejects a mention that is not an import line', () => {
    expect(claudeMdImportsAgents('See @AGENTS.md for the guide.\n')).toBe(false)
  })
})
