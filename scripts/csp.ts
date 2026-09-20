/**
 * Reading one directive out of a Content-Security-Policy (#407).
 *
 * Shared by the two layers that assert the policy, because they check the same thing about
 * different artifacts and a second copy of this would be free to drift from the first:
 * `scripts/csp-headers.test.ts` parses the policy as written in `public/_headers`, and
 * `tests/e2e/preview.spec.ts` parses the one Cloudflare actually served.
 */

/**
 * The source list of one directive, or `[]` when the directive is absent.
 *
 * **Absent is not "unrestricted", and callers should treat `[]` as a failure.** A missing *fetch*
 * directive falls back to `default-src`, which is `'self'` in this policy — so deleting `img-src`
 * refuses exactly the same requests that narrowing it would. Both mistakes have to fail the same
 * assertion or the assertion only covers one of them.
 *
 * Splitting on `;` first is the other half. A `toContain` against the whole policy string would
 * happily match a source that belongs to a *different* directive — `https://*.supabase.co` appears
 * in `connect-src` whether or not `img-src` still has it, which is the precise confusion that let
 * the original gap through.
 */
export function cspSources(policy: string, directive: string): string[] {
  const found = policy
    .split(';')
    .map((part) => part.trim())
    // The `${directive} ` guard keeps `img-src` from matching a longer name that starts with it,
    // such as `img-src-elem`, and the bare equality keeps a valueless directive parseable.
    .find((part) => part === directive || part.startsWith(`${directive} `))
  return found ? found.split(/\s+/).slice(1) : []
}
