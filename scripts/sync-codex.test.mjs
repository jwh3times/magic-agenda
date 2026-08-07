import { describe, it, expect } from 'vitest'
import {
  agentToToml,
  claudeMdImportsAgents,
  diffTrees,
  parseFrontmatter,
  planCodexTree,
  renderSkillFile,
  tomlMultilineString,
  tomlString,
} from './sync-codex.mjs'

const agentSource = `---
name: code-reviewer
description: Reviews diffs for the app/DB boundary, RLS, recurrence, and DnD rules.
tools: Read, Grep, Glob, Bash
---

Flag any of these, with file:line and the rule.
`

const skillSource = `---
name: ship
description: Use when a branch is ready for review.
---

# Ship

Take the branch to an open PR.
`

/** The text between the \`"""\` delimiters, with TOML basic-string escapes undone. */
function developerInstructions(toml) {
  const m = /developer_instructions = """\n([\s\S]*)\n"""/.exec(toml)
  return m === null ? null : m[1].replace(/\\(["\\])/g, '$1')
}

describe('parseFrontmatter', () => {
  it('splits the YAML keys from the body', () => {
    const { meta, body } = parseFrontmatter(agentSource)
    expect(meta).toEqual({
      name: 'code-reviewer',
      description: 'Reviews diffs for the app/DB boundary, RLS, recurrence, and DnD rules.',
      tools: 'Read, Grep, Glob, Bash',
    })
    expect(body).toBe('Flag any of these, with file:line and the rule.\n')
  })

  it('keeps colons inside a value', () => {
    const { meta } = parseFrontmatter('---\ndescription: Run after: a migration\n---\n\nbody\n')
    expect(meta.description).toBe('Run after: a migration')
  })

  it('skips a whole-line comment, e.g. a generated-file banner', () => {
    const { meta } = parseFrontmatter('---\n# a banner\nname: x\n---\n\nbody\n')
    expect(meta).toEqual({ name: 'x' })
  })

  it('preserves the body verbatim, including blank lines', () => {
    const { body } = parseFrontmatter('---\nname: x\n---\n\na\n\n\nb\n')
    expect(body).toBe('a\n\n\nb\n')
  })

  it('throws when the file has no frontmatter', () => {
    expect(() => parseFrontmatter('# Just markdown\n')).toThrow(/frontmatter/)
  })

  it('throws when the frontmatter is never closed', () => {
    expect(() => parseFrontmatter('---\nname: x\n\nbody\n')).toThrow(/frontmatter/)
  })
})

describe('tomlString', () => {
  it('quotes a plain value', () => {
    expect(tomlString('hello')).toBe('"hello"')
  })

  it('escapes backslashes and quotes', () => {
    expect(tomlString('a "b" \\ c')).toBe('"a \\"b\\" \\\\ c"')
  })

  it('escapes newlines so the value stays on one line', () => {
    expect(tomlString('a\nb')).toBe('"a\\nb"')
  })
})

describe('tomlMultilineString', () => {
  it('opens with a trimmed newline so the body starts clean', () => {
    expect(tomlMultilineString('a\nb')).toBe('"""\na\nb\n"""')
  })

  it('escapes every quote, so an embedded delimiter cannot terminate the string', () => {
    const rendered = tomlMultilineString('say """done"""')
    expect(rendered).not.toMatch(/[^\\]"""[^\n]/)
    expect(rendered).toBe('"""\nsay \\"\\"\\"done\\"\\"\\"\n"""')
  })

  it('escapes backslashes, which TOML basic strings would otherwise read as escapes', () => {
    expect(tomlMultilineString('C:\\path\\n')).toBe('"""\nC:\\\\path\\\\n\n"""')
  })

  it('does not leave a trailing blank line inside the delimiters', () => {
    expect(tomlMultilineString('body\n')).toBe('"""\nbody\n"""')
  })
})

describe('agentToToml', () => {
  const source = '.claude/agents/code-reviewer.md'

  it('carries name, description, and the body across', () => {
    const toml = agentToToml(source, agentSource)
    expect(toml).toContain('name = "code-reviewer"')
    expect(toml).toContain(
      'description = "Reviews diffs for the app/DB boundary, RLS, recurrence, and DnD rules."',
    )
    expect(developerInstructions(toml)).toBe('Flag any of these, with file:line and the rule.')
  })

  it('names its source file so the generated copy is never edited by hand', () => {
    expect(agentToToml(source, agentSource)).toContain(source)
  })

  it('locks an agent with no file-writing tools into a read-only sandbox', () => {
    expect(agentToToml(source, agentSource)).toContain('sandbox_mode = "read-only"')
  })

  it('leaves the sandbox alone when the agent may write files', () => {
    const writer = agentSource.replace('tools: Read, Grep, Glob, Bash', 'tools: Read, Write, Edit')
    expect(agentToToml(source, writer)).not.toContain('sandbox_mode')
  })

  it('leaves the sandbox alone when the source grants every tool', () => {
    const noTools = agentSource.replace('tools: Read, Grep, Glob, Bash\n', '')
    expect(agentToToml(source, noTools)).not.toContain('sandbox_mode')
  })

  it('records the Claude-only keys it dropped rather than losing them silently', () => {
    const withModel = agentSource.replace('tools:', 'model: sonnet\ntools:')
    const toml = agentToToml(source, withModel)
    expect(toml).toContain('model')
    expect(toml).not.toContain('model = ')
  })

  it('rejects a file whose frontmatter name disagrees with its filename', () => {
    expect(() => agentToToml('.claude/agents/reviewer.md', agentSource)).toThrow(/name/)
  })

  it('escapes a body that would otherwise break out of the TOML string', () => {
    const nasty = agentSource.replace('Flag any of these', 'Use """quotes""" and a \\ backslash')
    expect(developerInstructions(agentToToml(source, nasty))).toBe(
      'Use """quotes""" and a \\ backslash, with file:line and the rule.',
    )
  })
})

describe('renderSkillFile', () => {
  it('points SKILL.md back at its source as a YAML comment on line 2', () => {
    const rendered = renderSkillFile('.agents/skills/ship/SKILL.md', skillSource)
    const lines = rendered.split('\n')
    expect(lines[0]).toBe('---')
    expect(lines[1]).toBe(
      '# GENERATED from .agents/skills/ship/SKILL.md by scripts/sync-codex.mjs — do not edit; edit the source and run `npm run codex:sync`.',
    )
    expect(lines[2]).toBe('name: ship')
  })

  it('stays valid frontmatter after the banner is injected', () => {
    const rendered = renderSkillFile('.agents/skills/ship/SKILL.md', skillSource)
    const { meta, body } = parseFrontmatter(rendered)
    expect(meta.name).toBe('ship')
    expect(meta.description).toBe('Use when a branch is ready for review.')
    expect(body).toBe('# Ship\n\nTake the branch to an open PR.\n')
  })

  it('copies the prose verbatim — no CLAUDE.md rewriting', () => {
    const claudeAware = skillSource.replace(
      'Take the branch to an open PR.',
      'Never edit `CLAUDE.md` (an `@AGENTS.md` import).',
    )
    expect(renderSkillFile('.agents/skills/ship/SKILL.md', claudeAware)).toContain(
      'Never edit `CLAUDE.md` (an `@AGENTS.md` import).',
    )
  })

  it('leaves supporting files byte-identical', () => {
    const reference = '# Reference\n\nSome notes.\n'
    expect(renderSkillFile('.agents/skills/ship/references/notes.md', reference)).toBe(reference)
  })
})

describe('planCodexTree', () => {
  const sources = [
    { path: '.claude/agents/code-reviewer.md', content: agentSource },
    { path: '.agents/skills/ship/SKILL.md', content: skillSource },
    { path: '.agents/skills/ship/references/notes.md', content: '# Notes\n' },
  ]

  it('sends agents to .codex/agents and skills to .claude/skills', () => {
    expect([...planCodexTree(sources).keys()].sort()).toEqual([
      '.claude/skills/ship/SKILL.md',
      '.claude/skills/ship/references/notes.md',
      '.codex/agents/code-reviewer.toml',
    ])
  })

  it('mirrors nested skill files at the same relative path', () => {
    expect(planCodexTree(sources).get('.claude/skills/ship/references/notes.md')).toBe('# Notes\n')
  })

  it('ignores files that are neither an agent nor part of a skill', () => {
    const plan = planCodexTree([...sources, { path: '.claude/settings.json', content: '{}' }])
    expect([...plan.keys()]).not.toContain('.codex/settings.json')
  })
})

describe('diffTrees', () => {
  const desired = new Map([
    ['.codex/agents/a.toml', 'A'],
    ['.agents/skills/s/SKILL.md', 'S'],
  ])

  it('is clean when the tree on disk already matches', () => {
    expect(diffTrees(desired, new Map(desired))).toEqual({ missing: [], changed: [], stale: [] })
  })

  it('reports a file that was never generated', () => {
    const actual = new Map([['.codex/agents/a.toml', 'A']])
    expect(diffTrees(desired, actual).missing).toEqual(['.agents/skills/s/SKILL.md'])
  })

  it('reports a generated file edited out from under the source', () => {
    const actual = new Map([...desired, ['.codex/agents/a.toml', 'hand-edited']])
    expect(diffTrees(desired, actual).changed).toEqual(['.codex/agents/a.toml'])
  })

  it('reports a leftover from a deleted or renamed source', () => {
    const actual = new Map([...desired, ['.codex/agents/gone.toml', 'X']])
    expect(diffTrees(desired, actual).stale).toEqual(['.codex/agents/gone.toml'])
  })

  it('sorts each list so the failure output is stable', () => {
    const actual = new Map([
      ['.codex/agents/z.toml', 'Z'],
      ['.codex/agents/a2.toml', 'A2'],
    ])
    expect(diffTrees(new Map(), actual).stale).toEqual([
      '.codex/agents/a2.toml',
      '.codex/agents/z.toml',
    ])
  })
})

describe('claudeMdImportsAgents', () => {
  it('accepts the import pointer', () => {
    expect(claudeMdImportsAgents('# CLAUDE.md\n\n@AGENTS.md\n\nSee AGENTS.md.\n')).toBe(true)
  })

  it('rejects a CLAUDE.md that has grown its own copy of the guide', () => {
    expect(claudeMdImportsAgents('# CLAUDE.md\n\n## Commands\n\nnpm run dev\n')).toBe(false)
  })
})
