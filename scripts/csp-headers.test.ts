// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { cspSources } from './csp'

/**
 * What the Content-Security-Policy in `public/_headers` is load-bearing *for* (#407).
 *
 * The policy is a single long line that reads like configuration, so the thing it is easy to do is
 * tighten a directive without knowing which feature dies. This file is the list of what dies.
 *
 * **The whole point is that no other layer can catch this.** The unit suite runs under jsdom, which
 * enforces no CSP at all, so every component test passes against a policy that refuses the
 * resources those components load. `tests/e2e/preview.spec.ts` asserts the *served* header and is
 * the durable half of this check; it needs a deployed preview, so this file is the half that runs
 * in `npm test` and fails in seconds on the branch that breaks it.
 *
 * Each case names the feature, not the directive, because the directive is what a reader can
 * already see.
 */

const root = new URL('../', import.meta.url)
const read = (path: string) => readFileSync(new URL(path, root), 'utf8')

/**
 * The policy line itself. The two-space indent is what distinguishes the real rule from the long
 * comment block above it, which discusses the same directives in prose.
 */
function policy(): string {
  const csp = read('public/_headers').split('  Content-Security-Policy: ')[1]?.split('\n')[0]
  if (!csp) throw new Error('public/_headers has no Content-Security-Policy rule')
  return csp
}

/** The one Supabase origin every directive below has to admit: REST, Realtime, and Storage. */
const SUPABASE = 'https://*.supabase.co'

describe('the deployed Content-Security-Policy, by what depends on it', () => {
  it('admits attachment thumbnails, which are signed Storage URLs on the Supabase host (#278)', () => {
    // An `<img>` is governed by `img-src` alone — `connect-src` trusting the same host proves
    // nothing about it, which is exactly how this was missed the first time. Losing this refuses
    // every thumbnail in production, and the `onError` fallback in `AttachmentsSection` degrades a
    // refused image to the same `FILE` placeholder a PDF shows, so the board still looks roughly
    // right in a screenshot.
    expect(cspSources(policy(), 'img-src')).toContain(SUPABASE)
  })

  it('admits inline SVG assets the Vite build emits as data: URIs', () => {
    expect(cspSources(policy(), 'img-src')).toContain('data:')
  })

  it('admits the Supabase REST and Realtime origins the client talks to', () => {
    // Realtime is a WebSocket, so it needs its own scheme in the list; `https://` does not cover it.
    const connect = cspSources(policy(), 'connect-src')
    expect(connect).toContain(SUPABASE)
    expect(connect).toContain('wss://*.supabase.co')
  })

  it('admits the font hosts for the service worker, not only for the page', () => {
    // The page's own <link> is governed by style-src; the WORKER's fetch() of the same URL is
    // governed by connect-src. That gap shipped twice (v1.2.37) and only bit returning visitors.
    // See the post-mortem in `public/_headers`.
    const connect = cspSources(policy(), 'connect-src')
    expect(connect).toContain('https://fonts.googleapis.com')
    expect(connect).toContain('https://fonts.gstatic.com')
  })

  it('keeps the fallback closed, so a directive removed above is a refusal rather than a hole', () => {
    // This is what makes every assertion in this file mean "narrowed OR deleted".
    expect(cspSources(policy(), 'default-src')).toEqual(["'self'"])
  })
})

describe('cspSources, which both layers depend on', () => {
  // Asserted rather than described, because every assertion above is only as good as this, and a
  // parser that silently returns the wrong list turns a security check into a green rubber stamp.
  const POLICY =
    "default-src 'self'; img-src 'self' data: https://*.supabase.co; connect-src 'self' https://*.supabase.co"

  it('returns only the named directive, not a source that belongs to another one', () => {
    // The trap: `https://*.supabase.co` is in `connect-src` whether or not `img-src` still has it,
    // so a `toContain` on the whole policy string would pass with `img-src` already narrowed.
    expect(cspSources(POLICY, 'img-src')).toEqual(["'self'", 'data:', 'https://*.supabase.co'])
    expect(cspSources("default-src 'self'; connect-src https://*.supabase.co", 'img-src')).toEqual(
      [],
    )
  })

  it('treats an absent directive as empty rather than unrestricted', () => {
    // Deleting a fetch directive falls back to `default-src 'self'` — the same refusal narrowing
    // it would cause — so both mistakes have to fail the same assertion.
    expect(cspSources("default-src 'self'", 'img-src')).toEqual([])
  })

  it('does not match a longer directive that starts with the same name', () => {
    expect(cspSources("script-src-elem 'self'", 'script-src')).toEqual([])
  })
})
