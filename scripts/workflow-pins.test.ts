// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import { expect, test } from 'vitest'

const directory = new URL('../.github/workflows/', import.meta.url)
const workflows = readdirSync(directory)
  .filter((name) => /\.ya?ml$/.test(name))
  .map((name) => ({ name, source: readFileSync(new URL(name, directory), 'utf8') }))
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  devDependencies: { supabase: string }
}

// Check the committed workflows, not a second list of allowed versions. GitHub enforces SHA
// pins at execution time too; this gives a local failure before a workflow can be rejected.
test('every external action is pinned to a full commit SHA', () => {
  let actions = 0
  for (const { name, source } of workflows) {
    for (const [, reference] of source.matchAll(/^\s*(?:-\s+)?uses:\s*([^\s#]+)/gm)) {
      if (reference.startsWith('./')) continue
      expect({ workflow: name, pinned: /^[\w-]+\/[\w./-]+@[a-f0-9]{40}$/.test(reference) }).toEqual(
        { workflow: name, pinned: true },
      )
      actions++
    }
  }
  expect(actions).toBeGreaterThan(0)
})

test('every setup-cli install uses the same exact CLI version as local and RLS tests', () => {
  const version = manifest.devDependencies.supabase
  expect(version).toMatch(/^\d+\.\d+\.\d+$/)
  let installs = 0
  for (const { name, source } of workflows) {
    // Each setup action is a step; stop at the next step to avoid borrowing its inputs.
    const steps = source.split(/^\s*- (?=uses:|name:|run:|id:)/m)
    for (const step of steps) {
      if (!/(?:^|\n)\s*uses: supabase\/setup-cli@/.test(step)) continue
      const installed = step.match(/^\s+version:\s*([^\s#]+)/m)?.[1]
      expect({ workflow: name, version: installed }).toEqual({ workflow: name, version })
      installs++
    }
  }
  expect(installs).toBe(5)
})
