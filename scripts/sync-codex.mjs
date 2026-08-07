#!/usr/bin/env node
// Two independent generated trees, kept in sync with their authored sources. They run
// in OPPOSITE directions on purpose — each authored tree is wherever a human (or an
// installer) actually writes, not wherever looks symmetric:
//
//   .claude/agents/<name>.md      -> .codex/agents/<name>.toml    (converted)
//   .agents/skills/<name>/**      -> .claude/skills/<name>/**     (copied verbatim)
//
// Subagents are authored under `.claude/agents/` and generated for Codex, which loads
// only from `.codex/agents/`. Skills run the other way: `.agents/skills/` is where a
// skills installer (e.g. a Matt Pocock skills sync) writes real files, and Claude Code
// discovers skills by scanning `.claude/skills/` from the cwd up to the repo root — so
// that side is the generated one. Making `.agents/skills/` authored is what lets
// installing or updating a skill stay a one-way write with no manual copying back into
// `.claude/`.
//
// This used to run the same direction as the agents pipeline (`.claude/skills/` authored,
// `.agents/skills/` generated), with OS symlinks bridging the two so both paths worked
// without duplicating bytes. That broke for two independent reasons, both hit for real
// in this repo once a third-party installer wrote directly into `.agents/skills/` and
// symlinked `.claude/skills/<name>` back to it:
//   1. `readdirSync(dir, { withFileTypes: true })` reports a symlinked directory as
//      `isSymbolicLink()`, not `isDirectory()`. `walk()` below used to filter on
//      `isDirectory()`, so every symlinked skill was treated as a single file and handed
//      to `readFileSync`, which throws EISDIR on a directory target — reproduced here,
//      not hypothetical.
//   2. `git config core.symlinks` is `false` on this machine (common on Windows without
//      symlink privileges), so Git can't store a symlink as a symlink: `git add` on a
//      symlinked skill directory walks through it and stages the target's file contents
//      under the link's path, silently duplicating every byte instead of recording a link.
// `walk()` now throws immediately on any symlink it encounters, in either tree, so a
// regression here fails loudly instead of reproducing either failure mode.
//
// Skill prose is copied byte-for-byte. Do NOT "adapt" it: a blind CLAUDE.md ->
// AGENTS.md substitution is what produced gems like "edit AGENTS.md, never add
// content to AGENTS.md". References to CLAUDE.md are correct as written for both
// tools, because CLAUDE.md really does exist and really is just an @AGENTS.md import.
// The one injected difference is a banner naming the source file, added as a YAML
// comment on line 2 of a generated SKILL.md (line 1 stays `---`, so the frontmatter
// still parses) — every other file is passed through untouched.
//
//   node scripts/sync-codex.mjs           regenerate both trees (npm run codex:sync)
//   node scripts/sync-codex.mjs --check    verify, exit 1 on drift (npm run codex:check)
//
// The `Agents` CI job runs --check, so a PR that edits an authored tree without
// regenerating fails. Text files only — a non-UTF-8 skill asset is a hard error
// rather than a silently corrupted copy.

import { mkdirSync, readdirSync, readFileSync, rmdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, posix } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import process from 'node:process'

const AGENT_SRC = '.claude/agents'
const SKILL_SRC = '.agents/skills'
const AGENT_OUT = '.codex/agents'
const SKILL_OUT = '.claude/skills'

/** Claude tools that can modify the working tree. Absent => the agent only inspects. */
const WRITING_TOOLS = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit']

/** Frontmatter keys this generator understands. Anything else is reported as dropped. */
const TRANSLATED_KEYS = ['name', 'description', 'tools']

/**
 * Split a `---`-delimited YAML header from the markdown body. Deliberately minimal:
 * these files only ever use `key: value` scalars plus, since a generated SKILL.md always
 * carries a banner, whole-line `#` comments — a real YAML parser would be a dependency
 * for a script that CI runs without `npm ci`.
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
    if (line.trim() === '' || line.trim().startsWith('#')) continue
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
 * Render one file of a skill for the `.claude/skills` tree. `SKILL.md` gains a banner as
 * a YAML comment on line 2 — line 1 stays the opening `---`, so the frontmatter still
 * parses as valid YAML — and everything else is passed through untouched.
 *
 * @param {string} sourcePath - repo-relative posix path under `.agents/skills/`.
 * @param {string} text - source file contents.
 * @returns {string} contents to write into the `.claude/skills` tree.
 */
export function renderSkillFile(sourcePath, text) {
  if (posix.basename(sourcePath) !== 'SKILL.md') return text
  const m = /^---\n/.exec(text)
  if (m === null) {
    throw new Error(`${sourcePath}: expected a \`---\` YAML frontmatter block`)
  }
  const banner = `# GENERATED from ${sourcePath} by scripts/sync-codex.mjs — do not edit; edit the source and run \`npm run codex:sync\`.`
  return `${m[0]}${banner}\n${text.slice(m[0].length)}`
}

/**
 * The complete desired contents of both generated trees.
 *
 * Complete is the load-bearing word: anything on disk under those trees and absent
 * from this map is stale, and gets deleted (or reported) rather than left to rot.
 *
 * @param {{path: string, content: string}[]} sources - repo-relative posix paths under
 *   `.claude/agents/` (subagents) or `.agents/skills/` (skills) — the two authored trees.
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

/**
 * @returns {string[]} repo-relative posix paths of every file under `dir`, recursively.
 *
 * Throws on a symlink rather than silently mishandling it: `Dirent#isDirectory()` is
 * `false` for a symlinked directory, so a naive `isDirectory() ? walk() : [child]` treats
 * the link as a single file and hands it to `readFileSync`, which throws an opaque EISDIR
 * once it resolves through to the directory the link points at. Neither tree should ever
 * contain a symlink (see the file header), so failing loudly here is strictly better than
 * reproducing that failure mode with a worse stack trace.
 */
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
    if (entry.isSymbolicLink()) {
      throw new Error(`${child}: symlinks are not supported here — commit real files instead.`)
    }
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
      ? 'Generated agent and skill trees already match their authored sources.\n'
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
    if (inSync) process.stdout.write('Generated agent and skill trees match their authored sources.\n')
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
