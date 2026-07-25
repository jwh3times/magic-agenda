#!/usr/bin/env node
// Generates Codex's agent config from Claude's, so one session's house rules are
// the other's. `.claude/` is the source of truth; the Codex trees are build output.
//
//   .claude/agents/<name>.md      -> .codex/agents/<name>.toml   (converted)
//   .claude/skills/<name>/**      -> .agents/skills/<name>/**    (copied verbatim)
//
// Those two destinations are not a matched pair by choice — they are where Codex
// actually looks. Subagents load only from `.codex/agents/`, while skills are
// discovered by scanning `.agents/skills` from the cwd up to the repo root.
//
// Skill prose is copied byte-for-byte. Do NOT "adapt" it: a blind CLAUDE.md ->
// AGENTS.md substitution is what produced gems like "edit AGENTS.md, never add
// content to AGENTS.md". References to CLAUDE.md are correct as written for both
// tools, because CLAUDE.md really does exist and really is just an @AGENTS.md import.
// The one injected byte is a banner naming the source file.
//
//   node scripts/sync-codex.mjs           regenerate both trees (npm run codex:sync)
//   node scripts/sync-codex.mjs --check    verify, exit 1 on drift (npm run codex:check)
//
// The `Agents` CI job runs --check, so a PR that edits `.claude/` without
// regenerating fails. Text files only — a non-UTF-8 skill asset is a hard error
// rather than a silently corrupted copy.

import { mkdirSync, readdirSync, readFileSync, rmdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, posix } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import process from 'node:process'

const AGENT_SRC = '.claude/agents'
const SKILL_SRC = '.claude/skills'
const AGENT_OUT = '.codex/agents'
const SKILL_OUT = '.agents/skills'

/** Claude tools that can modify the working tree. Absent => the agent only inspects. */
const WRITING_TOOLS = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit']

/** Frontmatter keys this generator understands. Anything else is reported as dropped. */
const TRANSLATED_KEYS = ['name', 'description', 'tools']

/**
 * Split a `---`-delimited YAML header from the markdown body. Deliberately minimal:
 * these files only ever use `key: value` scalars, and a real YAML parser would be a
 * dependency for a script that CI runs without `npm ci`.
 *
 * @param {string} text - file contents.
 * @returns {{meta: Record<string, string>, body: string}} body keeps its original spacing.
 */
export function parseFrontmatter(text) {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text)
  if (m === null) {
    throw new Error('expected a `---` YAML frontmatter block at the top of the file')
  }
  const meta = {}
  for (const line of m[1].split('\n')) {
    if (line.trim() === '') continue
    const pair = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line)
    if (pair === null) {
      throw new Error(`frontmatter line is not a simple \`key: value\` pair: ${line}`)
    }
    meta[pair[1]] = pair[2].trim()
  }
  return { meta, body: text.slice(m[0].length).replace(/^\n/, '') }
}

/**
 * A single-line TOML basic string.
 *
 * @param {string} value
 * @returns {string} including the surrounding quotes.
 */
export function tomlString(value) {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`
}

/**
 * A multi-line TOML basic string. Every `"` is escaped — not just the delimiter
 * sequence — so no arrangement of quotes in the body can close the string early,
 * and a body ending in `"` stays legal.
 *
 * @param {string} value
 * @returns {string} including the surrounding `"""` delimiters.
 */
export function tomlMultilineString(value) {
  const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n+$/, '')
  return `"""\n${escaped}\n"""`
}

/**
 * Convert one Claude subagent definition into a Codex agent file.
 *
 * `tools:` has no Codex equivalent, but its intent does: an agent granted no
 * file-writing tools is meant to inspect only, which is `sandbox_mode = "read-only"`.
 * `model:` is dropped rather than guessed at — Claude's tiers name no Codex model,
 * and Codex already has `agents.default_subagent_model` for this.
 *
 * @param {string} sourcePath - repo-relative posix path of the `.md` source.
 * @param {string} text - source file contents.
 * @returns {string} TOML file contents.
 */
export function agentToToml(sourcePath, text) {
  const { meta, body } = parseFrontmatter(text)
  const expected = posix.basename(sourcePath, '.md')
  if (meta.name !== expected) {
    throw new Error(
      `${sourcePath}: frontmatter name "${meta.name}" does not match the filename "${expected}"`,
    )
  }
  if (!meta.description) {
    throw new Error(`${sourcePath}: a Codex agent requires a description`)
  }

  const dropped = Object.keys(meta).filter((key) => !TRANSLATED_KEYS.includes(key))
  const lines = [
    '# GENERATED FILE — do not edit.',
    `# Source: ${sourcePath}`,
    '# Regenerate with `npm run codex:sync`; the CI `Agents` job fails if the two drift.',
  ]
  if (dropped.length > 0) {
    lines.push(
      '#',
      `# Not carried over from the Claude frontmatter: ${dropped.join(', ')}. Claude model`,
      '# tiers name no Codex model — Codex uses agents.default_subagent_model instead.',
    )
  }
  lines.push('', `name = ${tomlString(meta.name)}`, `description = ${tomlString(meta.description)}`)

  if (meta.tools !== undefined) {
    const tools = meta.tools.split(',').map((tool) => tool.trim())
    if (!tools.some((tool) => WRITING_TOOLS.includes(tool))) {
      lines.push(
        '',
        `# The Claude source grants no file-writing tools (${meta.tools}), so this agent`,
        '# inspects only.',
        'sandbox_mode = "read-only"',
      )
    }
  }

  lines.push('', `developer_instructions = ${tomlMultilineString(body)}`, '')
  return lines.join('\n')
}

/**
 * Render one file of a skill for the Codex tree. `SKILL.md` gains a banner below its
 * frontmatter — where it is visible to whoever (or whatever) opens the copy to edit
 * it — and everything else is passed through untouched.
 *
 * @param {string} sourcePath - repo-relative posix path under `.claude/skills/`.
 * @param {string} text - source file contents.
 * @returns {string} contents to write into the Codex tree.
 */
export function renderSkillFile(sourcePath, text) {
  if (posix.basename(sourcePath) !== 'SKILL.md') return text
  const m = /^---\n[\s\S]*?\n---\n/.exec(text)
  if (m === null) {
    throw new Error(`${sourcePath}: expected a \`---\` YAML frontmatter block`)
  }
  const banner =
    `<!-- GENERATED from ${sourcePath} by scripts/sync-codex.mjs — ` +
    'edit the source and run `npm run codex:sync`. -->'
  return `${m[0]}\n${banner}\n${text.slice(m[0].length)}`
}

/**
 * The complete desired contents of both generated trees.
 *
 * Complete is the load-bearing word: anything on disk under those trees and absent
 * from this map is stale, and gets deleted (or reported) rather than left to rot.
 *
 * @param {{path: string, content: string}[]} sources - repo-relative posix paths under `.claude/`.
 * @returns {Map<string, string>} output path -> contents.
 */
export function planCodexTree(sources) {
  const plan = new Map()
  for (const { path, content } of sources) {
    if (path.startsWith(`${AGENT_SRC}/`) && path.endsWith('.md')) {
      const name = posix.basename(path, '.md')
      plan.set(`${AGENT_OUT}/${name}.toml`, agentToToml(path, content))
    } else if (path.startsWith(`${SKILL_SRC}/`)) {
      const rest = path.slice(`${SKILL_SRC}/`.length)
      plan.set(`${SKILL_OUT}/${rest}`, renderSkillFile(path, content))
    }
  }
  return plan
}

/**
 * @param {Map<string, string>} desired - from planCodexTree.
 * @param {Map<string, string>} actual - what is on disk in the generated trees.
 * @returns {{missing: string[], changed: string[], stale: string[]}} each sorted.
 */
export function diffTrees(desired, actual) {
  const missing = []
  const changed = []
  for (const [path, content] of desired) {
    if (!actual.has(path)) missing.push(path)
    else if (actual.get(path) !== content) changed.push(path)
  }
  const stale = [...actual.keys()].filter((path) => !desired.has(path))
  return { missing: missing.sort(), changed: changed.sort(), stale: stale.sort() }
}

/**
 * CLAUDE.md must stay a pointer at AGENTS.md. The moment it grows its own copy of the
 * guide, the two forks apart — which is the drift this whole script exists to prevent.
 *
 * @param {string} text - CLAUDE.md contents.
 * @returns {boolean}
 */
export function claudeMdImportsAgents(text) {
  return /^@AGENTS\.md\s*$/m.test(text)
}

// ---------------------------------------------------------------------------
// Filesystem shell. Everything above is pure and unit-tested.
// ---------------------------------------------------------------------------

// Resolved on demand, not at import: under Vitest `import.meta.url` is not a file URL,
// and the pure exports above must stay importable there.
const repoRoot = () => fileURLToPath(new URL('..', import.meta.url))

/** @returns {string[]} repo-relative posix paths of every file under `dir`, recursively. */
function walk(dir) {
  const absolute = join(repoRoot(), dir)
  let entries
  try {
    entries = readdirSync(absolute, { withFileTypes: true })
  } catch {
    return [] // A tree that does not exist yet is simply empty.
  }
  return entries.flatMap((entry) => {
    const child = `${dir}/${entry.name}`
    return entry.isDirectory() ? walk(child) : [child]
  })
}

/** Reads a file as UTF-8 text, normalizing line endings so the comparison is eol-agnostic. */
function readText(path) {
  const bytes = readFileSync(join(repoRoot(), path))
  const text = bytes.toString('utf8')
  if (!Buffer.from(text, 'utf8').equals(bytes)) {
    throw new Error(`${path}: not UTF-8 text. This script copies text files only.`)
  }
  return text.replace(/\r\n/g, '\n')
}

function readSources() {
  return [...walk(AGENT_SRC).filter((path) => path.endsWith('.md')), ...walk(SKILL_SRC)].map(
    (path) => ({ path, content: readText(path) }),
  )
}

function readGeneratedTrees() {
  return new Map([...walk(AGENT_OUT), ...walk(SKILL_OUT)].map((path) => [path, readText(path)]))
}

/**
 * Removes `dir` and each now-empty parent, stopping at the repo root. `rmdirSync`, not
 * `rmSync`: it refuses to delete a non-empty directory, so a race can't take real files.
 *
 * @param {string} dir - repo-relative posix path.
 */
function pruneEmptyDirs(dir) {
  for (let current = dir; current && current !== '.'; current = posix.dirname(current)) {
    const absolute = join(repoRoot(), current)
    try {
      if (readdirSync(absolute).length > 0) return
      rmdirSync(absolute)
    } catch {
      return
    }
  }
}

function write(desired, { missing, changed, stale }) {
  for (const path of [...missing, ...changed]) {
    const absolute = join(repoRoot(), path)
    mkdirSync(dirname(absolute), { recursive: true })
    writeFileSync(absolute, desired.get(path))
  }
  for (const path of stale) {
    rmSync(join(repoRoot(), path))
    pruneEmptyDirs(posix.dirname(path))
  }
  const touched = missing.length + changed.length + stale.length
  process.stdout.write(
    touched === 0
      ? 'Codex agent config is already in sync with .claude/.\n'
      : `Synced ${touched} file(s): ${missing.length} added, ${changed.length} updated, ${stale.length} removed.\n`,
  )
}

function report({ missing, changed, stale }) {
  const problems = [
    ['is missing — the source exists but was never generated', missing],
    ['was edited by hand, or its source changed', changed],
    ['is stale — no source produces it any more', stale],
  ]
  for (const [what, paths] of problems) {
    for (const path of paths) {
      process.stdout.write(`::error file=${path}::${path} ${what}. Run \`npm run codex:sync\`.\n`)
    }
  }
}

function main() {
  const check = process.argv.includes('--check')
  const desired = planCodexTree(readSources())
  const diff = diffTrees(desired, readGeneratedTrees())
  const inSync = diff.missing.length + diff.changed.length + diff.stale.length === 0

  // Not generated, but the same invariant: one source of truth per tool.
  const importsAgents = claudeMdImportsAgents(readText('CLAUDE.md'))
  if (!importsAgents) {
    process.stdout.write(
      '::error file=CLAUDE.md::CLAUDE.md no longer contains an `@AGENTS.md` import line. It must stay a pointer at AGENTS.md, never a second copy of the guide.\n',
    )
  }

  if (check) {
    if (inSync) process.stdout.write('Codex agent config matches .claude/.\n')
    else report(diff)
    process.exit(inSync && importsAgents ? 0 : 1)
  }

  write(desired, diff)
  process.exit(importsAgents ? 0 : 1)
}

// Run main() only when executed directly, not when imported by the test.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
