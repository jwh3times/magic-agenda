# PKCE Auth Flow — Design

- **Date:** 2026-07-25
- **Status:** Approved, not yet implemented
- **Revised:** 2026-07-25 (post-review) — `verifyOtp` emits `PASSWORD_RECOVERY` itself so
  `AuthProvider` is unchanged; single-use-token re-entry rules for `/auth/reset`; StrictMode
  once-guards; residual-risk acceptance; cutover note extended to signup confirmations
- **Drives:** Finding 1 of [`private/2026-07-25-security-review.md`](../../private/2026-07-25-security-review.md)
  (Medium — session fixation via unbound implicit-flow tokens)

## Problem

The Supabase client is created with `detectSessionInUrl: true` and no `flowType`, so
`@supabase/auth-js` runs its **implicit** flow. In that mode any URL on the origin carrying
`#access_token=…` is treated as an auth callback, with **no `state`, nonce, or code-verifier
binding** — the only validation is "is this a valid token for this project", which is true of a
token the attacker minted for their own account.

An attacker who sends a victim
`https://magicagenda.app/#access_token=<attacker>&refresh_token=<attacker>&expires_in=3600&token_type=bearer`
silently replaces the victim's session with their own and clears the fragment. Tasks the victim
subsequently creates are written with the attacker's `user_id` and are readable from the attacker's
account. The victim is simultaneously signed out of their real account. A `type=recovery` variant
routes the victim to `/auth/reset` to set a password on the attacker's account.

Existing data is never exposed — RLS still scopes reads to the true owner — which is why this is
Medium rather than High.

## The correction that shapes this design

The security review's initial recommendation was `flowType: 'pkce'`. **That alone does not fix it.**

In `@supabase/auth-js@2.110.8`, `_initialize()` dispatches on callback type
(`GoTrueClient.js:375-381`):

```js
if (this._isImplicitGrantCallback(params)) { callbackUrlType = 'implicit' }
else if (await this._isPKCECallback(params)) { callbackUrlType = 'pkce' }
```

`_isImplicitGrantCallback` never consults `this.flowType`, and the only gate on processing
(line 389) is `this.detectSessionInUrl && callbackUrlType !== 'none'` — also independent of
`flowType`. So with `flowType: 'pkce'` set, a crafted fragment URL is still classified as an
implicit callback and still adopted.

The actual control is the **function form** of `detectSessionInUrl`, which is public, typed API
(`lib/types.d.ts:58`) and documented for exactly this purpose:

```ts
detectSessionInUrl?: boolean | ((url: URL, params: { [k: string]: string }) => boolean)
```

`_isImplicitGrantCallback` delegates to it when it is a function. Returning `false` disables
implicit detection outright while leaving PKCE detection intact — the line 389 guard only tests
truthiness, and a function is truthy.

**Framing for the whole change:** the security fix is one line, `detectSessionInUrl: () => false`.
Everything else in this spec exists because turning fragment adoption off breaks the email flows
that currently depend on it.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| In-flight links at cutover | **Clean cut** — accept a brief break | All email OTPs share one `otp_expiry` (3600s in `config.toml`; the prod value is unverified — part of the config-drift follow-up), so the blast radius is users mid-reset **or mid-signup-confirm** within that window. Old-template signup links degrade gracefully: the `/verify` GET still confirms the email server-side, the fragment redirect is then ignored, and the user lands at `/login` signed out — confusing but recoverable (password sign-in works immediately). Old reset links land on the "invalid or expired" card and the user requests a new one. The alternative (dual-format tolerance) keeps the vulnerable path open and adds code written only to be deleted. |
| Signup-confirm landing | **New `/auth/confirm`, signs the user straight in** | `verifyOtp` returns a session, so the "confirm, then come back and sign in" round trip is unnecessary. Keeps `/auth/callback` purely OAuth. |
| Template delivery | **Manual dashboard edit** | Keeps the security fix small and shippable. See "Rejected: templates as code" below. |

### Rejected: templates as code via `supabase config push`

`supabase config push` (CLI 2.109.1) can push `[auth.email.template.*]` blocks with
`content_path` files, which would version-control the templates and land them with the merge.
**Rejected for this change**, because the repo's `config.toml` has never been reconciled with
production and a push today would be destructive:

| `config.toml` | Production | Effect of a push |
|---|---|---|
| `site_url = "http://localhost:5173"` | `https://magicagenda.app` | Breaks prod auth entirely |
| `additional_redirect_urls` = localhost only | prod + Pages URLs | Wipes the redirect allow-list |
| `minimum_password_length = 6` | 10 | Reverts 2026-06-30 Finding 2 remediation |
| `password_requirements = ""` | lower+upper+digit+symbol | Reverts complexity requirement |
| `enable_confirmations = false` | on | Disables email confirmation |
| `secure_password_change = false` | on | Reverts require-current-password |

Reconciling all of that is real work with a real blast radius, and wrapping it around a security
fix would delay closing an open finding. **Filed as a separate item** — see "Follow-ups".

## Design

### Client configuration — `src/lib/supabase.ts`

```ts
export const supabase = createClient<Database>(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    flowType: 'pkce',
    // Never adopt implicit-grant tokens from a URL fragment: that path has no
    // state/nonce binding and is the session-fixation vector. Email links now
    // carry ?token_hash= and are redeemed explicitly via verifyOtp().
    detectSessionInUrl: () => false,
  },
})
```

Two knock-on behaviors of `() => false`, both acceptable:

1. **OAuth error redirects stop being processed.** A cancelled Google consent screen returns
   `#error=access_denied…` with no `code`; today that classifies as an implicit callback and
   surfaces an error result, under the function form it classifies as `none` and is ignored. The
   app behaves identically either way — `AuthCallback` bounces any sessionless visitor to `/login`
   without a message — but if we ever want to *show* OAuth errors on the callback page, this
   predicate (or `AuthCallback` parsing the URL itself) is where that work lives.
2. **A signed-in user visiting `/auth/reset` with no token now gets the error card**, where today
   the live session shows the change-password form (and `updateUser` would change *that* session's
   password). That path was an accident of `detectSessionInUrl`-era wiring, not a designed feature.

### Components

| File | Change |
|---|---|
| `src/lib/supabase.ts` | The config above |
| `src/pages/ResetPassword.tsx` | The password form renders whenever `session && passwordRecovery` — that covers fresh redemption *and* reload / `ProtectedRoute` re-entry (see "Single-use tokens" below). The mount effect exists only to redeem a fresh link: if `token_hash` is in the query string and there is no session, call `verifyOtp({ token_hash, type: 'recovery' })` **exactly once** (ref guard — StrictMode double-invokes the effect and the token is single-use; same class as `useTasks`' `reload()` in-flight guard) and scrub the token from the URL with `replaceState`. While redeeming, show a spinner, not the error card. If a non-recovery session already exists, refuse to redeem (see "Residual risk"). The existing "link is invalid or has expired" card (lines 25-44) is the state for a missing or failed token with no recovery session. |
| `src/pages/AuthConfirm.tsx` *(new)* | Single purpose: `verifyOtp({ token_hash, type: 'signup' })` — **exactly once** (same StrictMode ref guard) — then redirect to `/`. If a session already exists, don't redeem: show "you're already signed in" with a link to `/` (covers a second click on the link, and is the fixation guard from "Residual risk"). On failure, an error message with a link to `/login`. |
| `src/App.tsx` | Register `/auth/confirm` as a **public** route (not wrapped in `ProtectedRoute`), alongside the existing public `/auth/reset`. |
| `src/pages/Login.tsx` | `signUp` gains `emailRedirectTo: ${window.location.origin}/auth/confirm`. Line 60 copy drops "then sign in" — confirmation now signs the user in. |
| `src/auth/AuthProvider.tsx` | **No change.** `verifyOtp({ type: 'recovery' })` fires `PASSWORD_RECOVERY` itself, so the existing handler keeps setting the flag — see "Why the recovery gate still works". |

`src/pages/AuthCallback.tsx` is unchanged: Google OAuth returns `?code=`, PKCE handles it, and the
component already just waits for a session.

### Data flow after the change

```
Password reset
  Login "forgot"  → resetPasswordForEmail(email, { redirectTo: origin + '/auth/reset' })
  email link      → /auth/reset?token_hash=…&type=recovery
  ResetPassword   → verifyOtp({ token_hash, type: 'recovery' })  → PASSWORD_RECOVERY event
                  → AuthProvider sets session + recovery flag
                  → updateUser({ password }) → clearPasswordRecovery() → /

Signup confirm
  Login "signup"  → signUp({ email, password, options: { emailRedirectTo: origin + '/auth/confirm' } })
  email link      → /auth/confirm?token_hash=…&type=signup
  AuthConfirm     → verifyOtp({ token_hash, type: 'signup' }) → session → /

Google OAuth (unchanged)
  Login           → signInWithOAuth({ redirectTo: origin + '/auth/callback' })
  provider        → /auth/callback?code=…
  auth-js         → PKCE exchange → session → AuthCallback redirects to /
```

### Why the recovery gate still works (no `AuthProvider` change)

Today `ProtectedRoute` forces a recovery session to `/auth/reset` so a recovery link cannot be used
to browse the board without setting a password. That gate is driven by the `PASSWORD_RECOVERY`
event. URL parsing stops firing it — but `verifyOtp` fires it directly
(`GoTrueClient.js:2021` in 2.110.8):

```js
await this._notifyAllSubscribers(params.type == 'recovery' ? 'PASSWORD_RECOVERY' : 'SIGNED_IN', session);
```

The notification is awaited before `verifyOtp` resolves, so `AuthProvider`'s existing handler has
already persisted the per-tab flag by the time `ResetPassword` sees the result. Neither
`AuthProvider` nor `ProtectedRoute` changes. (An earlier draft of this spec had `ResetPassword` set
the flag explicitly on the assumption the event was gone; that would be harmless redundancy, not a
requirement.)

### Single-use tokens: "verified" must not be derived from redemption

A successful `verifyOtp` consumes the `token_hash`, so a design where the password form appears
"only after `verifyOtp` succeeds in this mount" breaks whenever the current mount is not the one
that redeemed:

- **Reload** of `/auth/reset?token_hash=…` before submitting re-runs `verifyOtp` with a spent
  token → "invalid or expired" card, despite a valid session and recovery flag.
- **Re-entry:** after verifying, navigating to `/` bounces off `ProtectedRoute` back to
  `/auth/reset` — now token-less → error card. From there, `/login` redirects a signed-in user to
  `/`, which bounces back here: a loop with no exit.

Hence the rule in the component table: the form renders on `session && passwordRecovery` (both
survive a reload — the session in localStorage, the flag in per-tab sessionStorage), and redemption
is only the entry path that establishes that state. Scrubbing the spent token from the URL keeps it
out of history and makes reload behavior unambiguous.

## Residual risk: fixation is narrowed, not eliminated

`verifyOtp` redeems any valid `token_hash` — including one an attacker minted for an account they
control (request a recovery email for their own account, or sign up and skip confirming, then copy
the link from their own inbox). Luring a victim to `/auth/confirm?token_hash=…&type=signup` or
`/auth/reset?token_hash=…&type=recovery` would still hand the victim the attacker's session. What
this design changes versus Finding 1:

|  | Implicit fragment (today) | `token_hash` redemption (after) |
|---|---|---|
| Surface | any URL on the origin | two dedicated routes |
| Token | mintable at will, reusable while valid | single-use, expires per `otp_expiry` (1h) |
| Visibility | silent — fragment scrubbed, no UI | recovery forces the reset form; confirm lands on an unfamiliar, empty board |

The refuse-to-redeem-over-an-existing-session guard on both pages (component table) removes the
replace-a-real-session variant — the specific behavior that made Finding 1 Medium. What remains is
login CSRF against a signed-out visitor: the victim ends up inside the attacker's account, and
anything they enter there is readable by the attacker. That residual is inherent to emailed-link
auth (a link cannot be bound to the browser that will open it without breaking cross-device
email), is bounded by the single-use/short-expiry properties above, and is **accepted**.

## Manual steps (dashboard — not in the PR)

Performed close to the merge, per the clean-cut decision:

0. **Precondition — custom SMTP (required; settled 2026-07-25):** the dashboard templates are
   **confirmed read-only** — Supabase's
   [2026-06-03 change](https://supabase.com/changelog/46599-changes-to-email-template-customisation-on-free-tier)
   (templates read-only for free-tier projects created on/after 2026-06-03 on the default email
   provider) applies to this project, created 2026-06-29 with custom SMTP off. Configure custom
   SMTP first — it restores template editing and the Supabase plan stays free (free-tier SMTP
   providers suffice). Empirical footnote: non-team delivery *worked* on the default provider
   here despite docs saying it's refused; editing, not delivery, is what gates steps 1-2.
1. **Reset password** template → `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=recovery`
2. **Confirm signup** template → `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=signup`
3. **Redirect allow-list** → add the `/auth/confirm` callback

Both variables are verified against Supabase's email-template docs: `{{ .TokenHash }}` is the hashed
token for custom links, and `{{ .RedirectTo }}` is populated by the `redirectTo` / `emailRedirectTo`
passed to `resetPasswordForEmail` and `signUp` respectively — which is why those options must stay
in `Login.tsx`. Valid `type` values are `email`, `signup`, `invite`, `recovery`, `email_change`,
`reauthentication`; this design uses `recovery` and `signup`.

## Testing

**Unit** (mocking `verifyOtp`): success, invalid/expired token, and missing `token_hash` for both
`ResetPassword` and `AuthConfirm`. Plus, per the corrections above:

- **Redeem exactly once** — a StrictMode-style double mount calls `verifyOtp` once (assert on the
  mock's call count).
- **Re-entry** — `session && passwordRecovery` with no `token_hash` renders the form and never
  calls `verifyOtp`.
- **Already signed in** — an existing non-recovery session plus a `token_hash` refuses to redeem,
  on both pages.
- Because `verifyOtp` is mocked, its real `PASSWORD_RECOVERY` emission never happens in tests: the
  harness must emit the event through the mocked `onAuthStateChange` so tests exercise the same
  flag path production uses, not a test-only shortcut.

Updates to `ResetPassword.test.tsx` and `Login.test.tsx` (signup now passes `emailRedirectTo`,
copy changed), plus a new `AuthConfirm.test.tsx`.

**Manual, post-merge — mandatory.** Unit tests mock the SDK and therefore cannot prove the email
templates are correct. The templates are the highest-risk part of this change and are only
exercised by a real send:

1. Sign up with a throwaway address → confirmation link signs you in and lands on the board.
2. Request a password reset → link opens `/auth/reset`, a new password can be set, and it works on
   next sign-in.
3. Mid-reset reload: open a reset link, reload the page before submitting → the password form is
   still shown (not the "invalid or expired" card).
4. Google OAuth still completes.
5. Sanity: `https://magicagenda.app/#access_token=<any>` no longer establishes a session.

## Rollback

Revert both templates to `{{ .ConfirmationURL }}` and revert the merge. Both are fast, which is
what makes the clean cut acceptable.

## Out of scope

- **`config.toml` production divergence** — filed separately (see below).
- **Branded email styling** (ROADMAP 5.7) — these templates get touched here, but restyling is its
  own change. Sequencing note: 5.7 edits the same two templates, so doing it after this lands
  avoids editing them twice.
- **Email change flow** — not exposed in the app; only `updateUser({ password })` is used.
- The other carried-over review items (HIBP leaked-password protection, the Pages preview redirect
  wildcard).

## Follow-ups this spec creates

1. **Reconcile `supabase/config.toml` with production auth settings**, so `supabase config push` is
   safe to run. Today it would break prod login and revert the June hardening. This is a live
   landmine independent of PKCE.
2. Once (1) is done, optionally migrate the templates to code and deploy them via a workflow
   mirroring `deploy-migrations.yml`.
