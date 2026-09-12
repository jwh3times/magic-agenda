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

// The version used to be written out as a literal in all five workflows, which made every
// Dependabot bump of the CLI red on arrival: the bot cannot edit the workflows, so the PR stayed
// failing until a human aligned them by hand (#335, then #338). Each workflow now derives it from
// package.json at run time, so what is worth asserting is that the wiring is present -- an equality
// against the literal would now be trivially true.
//
// The format check is the load-bearing half rather than a leftover: setup-cli takes a bare version
// string, so a range like ^2.117.0 in devDependencies would be passed straight through and fail at
// install time. Nothing else in the repo requires that pin to be exact.
test('every setup-cli install derives its version from the exact package.json pin', () => {
  expect(manifest.devDependencies.supabase).toMatch(/^\d+\.\d+\.\d+$/)
  const derived = '${{ steps.cli.outputs.version }}'
  let installs = 0
  for (const { name, source } of workflows) {
    // Each setup action is a step; stop at the next step to avoid borrowing its inputs.
    const steps = source.split(/^\s*- (?=uses:|name:|run:|id:)/m)
    const cliSteps = steps.filter((step) => /(?:^|\n)\s*uses: supabase\/setup-cli@/.test(step))
    if (cliSteps.length === 0) continue
    // A version expression referencing a step that does not exist resolves to the empty string,
    // which setup-cli would silently read as "latest" -- so check the producer, not just the input.
    const produces = steps.some(
      (step) => /(?:^|\n)\s*id: cli(?:\s|$)/.test(step) && /devDependencies\.supabase/.test(step),
    )
    expect({ workflow: name, derivesTheVersion: produces }).toEqual({
      workflow: name,
      derivesTheVersion: true,
    })
    for (const step of cliSteps) {
      const installed = step.match(/^\s+version:\s*(\S.*?)\s*$/m)?.[1]
      expect({ workflow: name, version: installed }).toEqual({ workflow: name, version: derived })
      installs++
    }
  }
  expect(installs).toBe(5)
})
