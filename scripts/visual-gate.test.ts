// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const root = new URL('../', import.meta.url)
const read = (path: string) => readFileSync(new URL(path, root), 'utf8')
const workflow = read('.github/workflows/ci.yml')

function step(name: string): string {
  const marker = `      - name: ${name}\n`
  const start = workflow.indexOf(marker)
  if (start < 0) throw new Error(`Missing workflow step: ${name}`)
  const next = workflow.indexOf('\n      - name:', start + marker.length)
  return workflow.slice(start, next < 0 ? undefined : next)
}

describe('visual regression merge gate', () => {
  it('lets a visual mismatch fail the required E2E job', () => {
    const visual = step('Run the visual regression canaries')

    expect(visual).toContain('--project=visual --update-snapshots=missing')
    expect(visual).not.toContain('continue-on-error')
  })

  it('still collects and uploads candidate PNGs after a mismatch', () => {
    const collect = step('Collect the visual differences')
    const upload = step('Upload the visual differences')

    expect(collect).toContain('if: always()')
    expect(collect).toContain('continue-on-error: true')
    expect(upload).toContain('if: always()')
    expect(upload).toContain('continue-on-error: true')
  })
})
