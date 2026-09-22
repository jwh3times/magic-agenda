# Auth

Sign-in, email-token redemption, and two-factor. Read before touching `src/auth/`, `Login`,
`ResetPassword`, `AuthConfirm`, `AuthCallback`, `ProtectedRoute`, or `HomeRoute`.

## PKCE, not implicit-flow URL fragments

`src/lib/supabase.ts` sets `flowType: 'pkce'` and, critically, `detectSessionInUrl: () => false` (the
**function** form, not `false`): that disables implicit adoption of `#access_token=` URL fragments — a
session-fixation vector, since that path has no state/nonce binding — while leaving PKCE `?code=`
handling intact for Google OAuth (`AuthCallback`). Password-reset and signup-confirmation email links
carry `?token_hash=` and are redeemed explicitly via `verifyOtp()`: `ResetPassword`
(`/auth/reset`) renders its form on `session && passwordRecovery`, never on "redemption succeeded this
mount" (the token is single-use, so reloads and `ProtectedRoute` re-entry must still work); `AuthConfirm`
(`/auth/confirm`, a public route) redeems a signup token and signs the user straight in, skipping the
old "confirm, then come back and sign in" round trip. Both pages refuse to redeem over an existing
session (the residual session-fixation guard). `ProtectedRoute` is unchanged —
`verifyOtp({ type: 'recovery' })` still fires `PASSWORD_RECOVERY` itself.

The blocking same-origin `/auth-token-bootstrap.js` is the first script in `<head>`. On
`/auth/reset` and `/auth/confirm`, it copies `token_hash` into closure memory and immediately replaces
the live URL with the bare pathname while preserving `history.state`; every other route is left
alone. A classic blocking script is deliberate: the first module version still lost to a tiny
deferred end-of-body probe while its dependency graph loaded. `useTokenRedemption()` reads the
closure idempotently — required because StrictMode evaluates state initializers twice — and consumes
the shared copy only after mount, so a later client-side visit cannot replay it. **Do not move the
scrub into the app module or a React effect.** Cloudflare Web Analytics reads the live
`document.location.href` when its end-of-body beacon initializes; either later location can lose the
ordering race, and an effect also never scrubs on the wait or refuse paths.

## The auth seam: pages never touch `supabase.auth`

**`src/auth/authGateway.ts` is the only module in `src/` that may call `supabase.auth.*`.** Until
v1.2.55 seven of the ten call sites lived in `Login`, `ResetPassword`, and `AuthConfirm`, and the
cost was visible in the churn: the refuse-to-redeem guard had three different encodings, the error
policy four, and the redirect-after-success rule five. Every commit touching three or more of those
files was one conceptual change crossing a seam that did not exist.

Two invariants hold for **every** `AuthGateway` method, and they are why the interface earns its
keep:

1. **Nothing rejects.** Failures are values (`AuthOutcome`), never exceptions. That is structural,
   not stylistic — a missing `.catch` on `verifyOtp` used to strand `/auth/reset` and
   `/auth/confirm` on a spinner forever, with the single-use token already scrubbed from the URL.
2. **No vendor error type crosses it.** `src/auth/authOutcome.ts` maps GoTrue `error_code`s (not
   messages — those get reworded across releases) to an `AuthFailureReason` union this app owns.
   `unknown` is part of that union on purpose and keeps the vendor's own text, so an unmapped code
   degrades to the old behaviour rather than to silence. `bad-credentials` deliberately does not
   say which half was wrong; a message that did would make the sign-in form an account-enumeration
   oracle.

**Password sign-in, account creation, and password-reset email requests cross the seam with a
Turnstile token.** Supabase's CAPTCHA switch covers all three endpoints as one unit; it cannot be
enabled for sign-up/reset while leaving password sign-in unchanged. `Login` therefore renders one
`TurnstileWidget` for every email/password mode, disables the submit button until the challenge
succeeds, and passes that single-use token to `signIn`, `signUp`, or `sendPasswordReset`. The gateway
maps it to GoTrue's `options.captchaToken`; it never verifies the token in the browser. Every attempt
and mode change resets the widget, whether GoTrue accepted or refused the request, because
Cloudflare tokens cannot be reused. Expiry and widget errors clear the token, so a stale challenge
cannot authorize a later submission. Google OAuth does not use this challenge.

`TurnstileWidget` loads Cloudflare's script with explicit rendering because the containing form is
conditional SPA state. Its site key comes from `VITE_TURNSTILE_SITE_KEY` (public by design); the
secret stays behind GoTrue as `TURNSTILE_SECRET_KEY`. `public/_headers` must admit
`https://challenges.cloudflare.com` in both `script-src` and `frame-src`, and those headers require
verification on the deployed preview rather than under Vite. Keep `fakeAuthGateway`'s call logs
token-aware so component tests prove that the solved token, rather than a placeholder, crosses the
seam.

`Session`/`User` still cross the seam in the success direction, so the eleven modules reading
`session`/`user` off the context remain typed against the vendor. Narrowing that is deferred, not
overlooked.

**`redeemDecision()` in `src/auth/redemption.ts` is the single home of the session-fixation guard.**
It is pure and total, and **the clause order is the security property**: `hasSession` is tested
before `tokenHash`, so an existing session always wins and a valid token is never redeemed over it.
Reordering those two lines silently reopens the finding the 2026-07-25 review closed, which is why
`redemption.test.ts` asserts the refusal for a _valid_ token specifically.

`useTokenRedemption()` wraps it, and its two guards are separate on purpose. The **decision is
latched in state** once auth settles — without that, the app's own successful redemption produces a
session, the decision recomputes to `refuse`, and the page announces "you're already signed in" in
the middle of the flow it just completed (the real client fires `SIGNED_IN`/`PASSWORD_RECOVERY` from
_inside_ `verifyOtp`, before the promise resolves, so this is the normal path, not a race). A
**ref guards the redemption call itself and is read only inside the effect** — StrictMode runs
effect setup → cleanup → setup against the same latched decision, so without it a single-use token
is spent twice. Note `react-hooks/refs` forbids reading a ref during render, so the latch cannot be
collapsed back into the ref.

**Tests render the real `AuthProvider` with `fakeAuthGateway()`** (`src/auth/fakeAuthGateway.ts`,
the second adapter) rather than stubbing `useAuth`. The old approach hand-built a `vi.mock` factory
shaped like whichever methods each page happened to call, which is untyped: `Login.test.tsx` stubbed
3 of the context's 6 members while its siblings stubbed 6, and nothing caught the drift. The fake
carries no vitest import and nothing in the app imports it, so it never reaches the bundle.

`src/auth/verifyOtpContract.test.ts` pins the vendor ordering that the recovery gate depends on. It
lived in `src/lib/` with no module behind it; `redeemToken` is now its owner, which is why the
"do not defer this call" warning sits in that method's body.

**The seam grew by five methods for two-factor (TOTP) in #272** — `enrollTotp`, `verifyTotp`,
`listTotpFactors`, `unenrollFactor`, `getAssuranceLevel` — and both invariants above hold for all
five without exception. `verifyTotp` deliberately calls GoTrue's `challengeAndVerify` rather than
exposing `challenge` and `verify` as two gateway methods: a challenge expires, so issuing one when
a form opens and spending it only when the user finishes typing a six-digit code races the clock
for a benefit nothing here needs, and pairing them inside the seam means no component ever holds a
`challengeId` whose freshness it cannot reason about. Four `AuthFailureReason`s were added
(`invalid-code`, `challenge-expired`, `too-many-factors`, `factor-name-taken`); GoTrue's
`mfa_verification_rejected` is deliberately left unmapped — it means an auth hook refused an
otherwise-correct code, so telling the user to recheck their authenticator app would send them
around a loop that cannot terminate, and it falls through to `unknown` and keeps GoTrue's own text
instead. A new `AuthResult<T>` sits beside `AuthOutcome` for the three methods that hand back data
(an enrollment secret, a factor list, a session's assurance levels); `AuthOutcome` itself is
unchanged so the existing call sites keep reading `outcome.ok` with no `.data`. `fakeAuthGateway`
carries all five, and its `next.getAssuranceLevel` defaults to `aal1`/`aal1` — a user who owes no
code — specifically so every pre-existing signed-in test keeps rendering the route it always did
without being told about two-factor at all.

`src/auth/mfa.ts` is this feature's pure half, holding the same shape of split as `redemption.ts`
and `sw/policy.ts`: no I/O, no vendor import, so the questions worth testing are testable without a
GoTrue client. `stepUpRequired(levels)` is GoTrue's own rule restated as a total function —
`next === 'aal2' && current !== 'aal2'` rather than `current === 'aal1'` — because
`AuthenticatorAssuranceLevels` is an open union (`'aal1' | 'aal2' | (string & {})`, since GoTrue
reserves the right to add levels); testing for the level actually wanted is total, while testing
for the one that isn't would silently stop gating the day a new level appears. `nextFactorName`
exists because GoTrue rejects a duplicate `friendly_name`, so the settings UI has no name field at
all — a generated, collision-free name is cheaper than asking the user for one they don't care
about. `qrDataUri` percent-encodes GoTrue's raw SVG rather than following its docstring's
`data:image/svg+xml;utf-8,` shorthand literally: a `#` in the SVG (a fill colour) starts a URL
fragment and truncates the image, and `;utf-8` is not a media-type parameter the data-URL grammar
defines. `public/_headers`' `img-src` already admits `data:`, so no CSP change was needed for this.
(That directive gained `https://*.supabase.co` in #278 for attachment thumbnails, which does not
affect the QR code either way.)

**`AuthProvider` publishes `stepUpRequired: boolean | null`, keyed by user id rather than held as a
bare boolean, and the keying is what makes two awkward cases fall out for free.** A token refresh
(roughly hourly) replaces the session object; clearing the answer first would blink a spinner over
the board on every refresh, so the previous answer is kept while `getAssuranceLevel()` re-reads the
new one. But a _different_ user's answer must never be inherited — signing out of an `aal2` session
and into a freshly gated one must not paint the board for a frame first — so a user id that no
longer matches the current session reads as `null` ("undetermined") with no explicit reset needed.
`getAssuranceLevel()` is local: it decodes the stored JWT and reads the session's own factor list,
so it costs no network round trip and answers correctly offline.

**A failed assurance read fails OPEN, and this is the most important non-obvious call in the whole
feature.** Two-factor is not the authorization boundary here — RLS keys on `auth.uid()` alone, so
the database grants identical rows whether or not the session cleared `aal2` — and Supabase issues
no backup codes, so a user held behind a gate they cannot pass would have no way back into their
own account. Blocking on a failed read would be unrecoverable for a security property the database
was never going to enforce anyway.

**The gate is rendered in place in BOTH `ProtectedRoute` and `HomeRoute`, and that duplication is
required rather than accidental.** The board lives at `/`, served by `HomeRoute` in `App.tsx`, which
deliberately does **not** use `ProtectedRoute` — so `/settings` is the only route that component
actually reaches. `HomeRoute`'s own docstring has warned since it was written that a guard added
to one and not the other becomes a second copy that silently drifts, and this is the guard it was
warning about. #272 added the step-up check to
`ProtectedRoute` first, which covers `/settings` but not a single task; gating only `/settings`
would have been worse than shipping no gate at all, because it reads as protection while leaving
every task on the board one password away. `HomeRoute` now mirrors three guards from
`ProtectedRoute` in the same relative order — password recovery, offline fallback, two-factor
step-up — and `HomeRoute.test.tsx` pins all three. Unlike the recovery gate, the step-up gate is
rendered **in place** rather than navigated to: there is no route that corresponds to "you owe a
code", so there is no URL a user could type to step around it.

`src/auth/MfaChallenge.tsx` is that in-place screen. It offers Sign out and nothing else as an
escape hatch, because with no backup codes that is the only way off the screen the client can
offer; it names a factor with a picker only when more than one is enrolled, since a code is valid
only for the factor that generated it; and it explains itself rather than leaving a permanently
disabled button when the gate says a code is owed but the account's factor list comes back empty
(the last one was removed from another device between sign-in and this render).

Its copy tells a locked-out user to contact support, and
[the two-factor lockout runbook](../runbooks/two-factor-lockout.md) is what support then does —
rehearsed against a local stack rather than reasoned about. Two findings there are not guessable
from this code: removal must go through GoTrue's admin API rather than a `delete` from
`auth.mfa_factors`, because `auth.mfa_amr_claims` has **no** foreign key to that table and the raw
delete strands the `totp` claim (`auth.mfa_challenges` does cascade, so it is clean either way);
and removing the factor **does not release a user already sitting on this screen**, because
`getAssuranceLevel()` reads the stored JWT rather than the server — they stay gated until they sign
out or their token refreshes.

That runbook's step 0 — the identity bar support must clear before removing anyone's factor — became
decided policy on 2026-09-22, and it carries an accepted consequence worth knowing before you reason
about what two-factor protects here: **control of an account's mailbox is control of the account.**
The bar is the address on file, which is also all a password reset needs, so the two stack into a
full takeover for whoever holds the inbox. That is accepted deliberately, for the reason the runbook
states — no account has a phone number, a billing relationship, or any second channel to verify
against. Do not describe enrollment as surviving mailbox compromise; it does not.

`src/components/TwoFactorSection.tsx` is enrollment, mounted on `SettingsPage` as `security` /
"Two-factor authentication" between `data` and `danger`. Two rules there are easy to get backwards:
**an abandoned enrollment must be unenrolled, not merely forgotten** — `enrollTotp` writes a real,
unverified factor immediately, and while it grants nothing it does count against
`max_enrolled_factors = 10`, so a user who opens and cancels the form ten times would lock the
account out of ever enrolling again with nothing on screen explaining why — and **the factor list
deliberately does not filter to verified-only**, because a factor abandoned by a closed tab has to
be visible in order to be removable at all.
