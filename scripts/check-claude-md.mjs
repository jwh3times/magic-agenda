#!/usr/bin/env node
// CLAUDE.md must stay a pointer at AGENTS.md. The moment it grows its own copy of the guide, the
// two fork apart. Run by the `Agents` CI job alongside `node scripts/sync-agents.mjs --check`.
//
//   node scripts/check-claude-md.mjs

import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import process from 'node:process'

/**
 * @param {string} text - CLAUDE.md contents.
 * @returns {boolean} true when the file contains an `@AGENTS.md` import line.
 */
export function claudeMdImportsAgents(text) {
  return /^@AGENTS\.md\s*$/m.test(text)
}

function main() {
  const text = readFileSync(fileURLToPath(new URL('../CLAUDE.md', import.meta.url)), 'utf8')
  if (claudeMdImportsAgents(text)) {
    process.stdout.write('CLAUDE.md imports AGENTS.md.\n')
    return
  }
  process.stdout.write(
    '::error file=CLAUDE.md::CLAUDE.md no longer contains an `@AGENTS.md` import line. It must stay a pointer at AGENTS.md, never a second copy of the guide.\n',
  )
  process.exit(1)
}

// Run main() only when executed directly, not when imported by the test.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
