/**
 * The app's own vocabulary for two-factor authentication, plus the pure decisions taken over it.
 *
 * This module holds no I/O and imports nothing from the vendor. That is the same split
 * `redemption.ts` makes for the session-fixation guard and `sw/policy.ts` makes for the cache
 * policy: the question worth testing is separated from the call that answers it, so the answer
 * can be asserted without a GoTrue client, a JWT, or a network.
 *
 * Vendor shapes (`Factor`, `AuthMFAEnrollTOTPResponse`) stay behind `AuthGateway` and are
 * translated there. `Session` still crosses the seam in the success direction — see the note on
 * `AuthGateway` — but nothing new joins it.
 */

/** One enrolled TOTP factor, as the settings UI needs it. */
export interface TotpFactor {
  id: string
  /** GoTrue's `friendly_name`, absent on factors enrolled without one. */
  name: string | null
  /**
   * False until the user has proved they can generate a code from it. An unverified factor grants
   * nothing and does not raise the account's assurance level, but it **does** count against
   * `max_enrolled_factors`, which is why the UI lists them rather than hiding them.
   */
  verified: boolean
  createdAt: string
}

/** What `enroll` hands back: everything needed to show the user their new secret, once. */
export interface TotpEnrollment {
  factorId: string
  /** GoTrue returns the QR as a raw SVG document, not a URL. `qrDataUri` makes it renderable. */
  qrCodeSvg: string
  /** The base32 secret, for someone typing it in by hand instead of scanning. */
  secret: string
  /** The full `otpauth://` URI the QR encodes. */
  uri: string
}

/**
 * A session's assurance levels, as GoTrue reports them. Both are nullable there and stay nullable
 * here: a session with no `aal` claim at all is a real shape, not a bug to normalize away.
 */
export interface AssuranceLevels {
  current: string | null
  next: string | null
}

/**
 * Whether this session still owes a TOTP code.
 *
 * The rule is GoTrue's: `next` is raised to `aal2` exactly when the user holds at least one
 * **verified** factor, while `current` reflects what this session has actually presented. So a
 * gap between them means "you have a factor and you have not used it yet".
 *
 * Stated as `next === 'aal2' && current !== 'aal2'` rather than `current === 'aal1'` on purpose.
 * `AuthenticatorAssuranceLevels` is `'aal1' | 'aal2' | (string & {})` — an open union, because
 * GoTrue reserves the right to add levels — so testing for the level we want is total, while
 * testing for the one we don't would silently stop gating the day an `aal0` appears.
 */
export function stepUpRequired(levels: AssuranceLevels): boolean {
  return levels.next === 'aal2' && levels.current !== 'aal2'
}

/**
 * A friendly name for a new factor that no existing factor already carries.
 *
 * There is no name field in the UI, and this is why there does not need to be one. GoTrue rejects
 * a duplicate `friendly_name` with `mfa_factor_name_conflict`, so the alternatives were to ask the
 * user for a name they have no reason to care about, or to send none and let the second factor
 * collide with the first. Numbering sidesteps both.
 *
 * Unverified factors count: they occupy their name until they are removed.
 */
export function nextFactorName(existing: readonly TotpFactor[], base = 'Authenticator'): string {
  const taken = new Set(existing.map((f) => f.name))
  if (!taken.has(base)) return base
  for (let n = 2; ; n += 1) {
    const candidate = `${base} ${n}`
    if (!taken.has(candidate)) return candidate
  }
}

/**
 * GoTrue's QR code as something an `<img src>` can load.
 *
 * The vendor docstring says to prepend `data:image/svg+xml;utf-8,` and stop there. That is a
 * shorthand, not an encoding: a `#` anywhere in the document — the usual spelling of a fill
 * colour — starts a URL fragment, truncating the SVG at that point so the image renders blank,
 * and `;utf-8` is not a media-type parameter the data-URL grammar defines. Percent-encoding the
 * payload is correct whatever GoTrue happens to emit today, which is the point: this is one line
 * that cannot break when the generator's output changes.
 *
 * `img-src 'self' data:` in `public/_headers` already admits this; no CSP change is needed.
 */
export function qrDataUri(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}
