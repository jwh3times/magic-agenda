/**
 * Makes the drag tests' hover retry visible in CI (#644).
 *
 * `hoverOutOfInbox` in tests/e2e/smoke.spec.ts hovers again when its first hover leaves the card in
 * the Inbox. That keeps the suite steady, and it would also hide the thing #586 is waiting to see: a
 * hover that did nothing during a drag. So the helper records a `hover-retry` annotation when it
 * needed more than one attempt, and this module's reporter turns each one into a GitHub Actions
 * warning on the run, which a person sees without opening any artifact.
 *
 * The warning carries the test's title, the lane and the attempt count, and nothing from the page:
 * traces hold a bearer token and never leave the runner unencrypted (docs/agents/testing.md).
 *
 * Playwright's own `github` reporter prints failure annotations only, and a `::warning` line logged
 * from inside a test reaches the log behind the `list` reporter's title prefix, where GitHub does not
 * read it as a command. Hence a reporter of its own, writing whole lines as Playwright's does.
 * It lives under scripts/ rather than tests/ so `npm test` covers its formatter
 * (scripts/hover-retry.test.ts); the reporter class at the bottom is only the adapter.
 */
import path from 'node:path'
import type { Reporter, TestCase, TestResult } from '@playwright/test/reporter'

/** The annotation a drag test records when its hover needed more than one attempt. */
const HOVER_RETRY = 'hover-retry'

export interface Annotation {
  type: string
  description?: string
}

/** What a test that finished looks like to `retryWarnings`. */
export interface FinishedTest {
  title: string
  file: string
  line: number
  annotations: readonly Annotation[]
}

/** A workflow command's message escaping, as the GitHub Actions toolkit does it. */
function escapeData(text: string): string {
  return text.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')
}

export function hoverRetry(lane: string, attempts: number): Annotation {
  return { type: HOVER_RETRY, description: `the hover onto ${lane} took ${attempts} attempts` }
}

export function retryWarnings(test: FinishedTest, workspace: string): string[] {
  return test.annotations
    .filter((a) => a.type === HOVER_RETRY)
    .map((a) => {
      const message = escapeData(`${test.title}: ${a.description}`)
      const file = path.relative(workspace, test.file).split(path.sep).join('/')
      return `::warning file=${file},line=${test.line},title=Hover retry (#586)::${message}`
    })
}

/** Listed in playwright.config.ts's CI reporters, beside Playwright's `github` reporter. */
export default class HoverRetryReporter implements Reporter {
  onTestEnd(test: TestCase, result: TestResult): void {
    const finished = {
      // Without the root, project and file entries, which the warning's `file` already says.
      title: test.titlePath().slice(3).join(' › '),
      file: test.location.file,
      line: test.location.line,
      annotations: result.annotations,
    }
    const workspace = process.env.GITHUB_WORKSPACE ?? process.cwd()
    // From a fresh line: GitHub reads a workflow command only at the start of one.
    for (const line of retryWarnings(finished, workspace)) process.stdout.write(`\n${line}\n`)
  }

  printsToStdio(): boolean {
    return false
  }
}
