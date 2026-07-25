# PKCE Auth Flow — Design

- **Date:** 2026-07-25
- **Status:** Approved, not yet implemented
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
| In-flight links at cutover | **Clean cut** — accept a brief break | Reset links expire in ~1h, so the blast radius is only users mid-reset. The alternative (dual-format tolerance) keeps the vulnerable path open and adds code written only to be deleted. |
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

### Components

| File | Change |
|---|---|
| `src/lib/supabase.ts` | The config above |
| `src/pages/ResetPassword.tsx` | On mount, read `token_hash` + `type` from the query string and call `verifyOtp({ token_hash, type: 'recovery' })`; show the password form only after it succeeds. The existing "link is invalid or has expired" card (lines 25-44) becomes the error state. |
| `src/pages/AuthConfirm.tsx` *(new)* | Single purpose: `verifyOtp({ token_hash, type: 'signup' })`, then redirect to `/`. On failure, an error message with a link to `/login`. |
| `src/App.tsx` | Register `/auth/confirm` as a **public** route (not wrapped in `ProtectedRoute`), alongside the existing public `/auth/reset`. |
| `src/pages/Login.tsx` | `signUp` gains `emailRedirectTo: ${window.location.origin}/auth/confirm`. Line 60 copy drops "then sign in" — confirmation now signs the user in. |
| `src/auth/AuthProvider.tsx` | The `PASSWORD_RECOVERY` event no longer fires from URL parsing. `ResetPassword` sets the recovery flag explicitly after a successful `verifyOtp` instead. |

`src/pages/AuthCallback.tsx` is unchanged: Google OAuth returns `?code=`, PKCE handles it, and the
component already just waits for a session.

### Data flow after the change

```
Password reset
  Login "forgot"  → resetPasswordForEmail(email, { redirectTo: origin + '/auth/reset' })
  email link      → /auth/reset?token_hash=…&type=recovery
  ResetPassword   → verifyOtp({ token_hash, type: 'recovery' })  → session + recovery flag
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

### Why the recovery gate moves

Today `ProtectedRoute` forces a recovery session to `/auth/reset` so a recovery link cannot be used
to browse the board without setting a password. That gate is driven by the `PASSWORD_RECOVERY`
event, which fires when auth-js parses the emailed hash — a thing that no longer happens.

After `verifyOtp({ type: 'recovery' })` the user holds a full session and could navigate away
without setting a password, so the gate still has value. `ResetPassword` sets the flag itself
immediately after a successful verify. This is more direct than inferring intent from an event, and
`ProtectedRoute` needs no change.

## Manual steps (dashboard — not in the PR)

Performed close to the merge, per the clean-cut decision:

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
`ResetPassword` and `AuthConfirm`. Updates to `ResetPassword.test.tsx` and `Login.test.tsx`
(signup now passes `emailRedirectTo`, copy changed), plus a new `AuthConfirm.test.tsx`.

**Manual, post-merge — mandatory.** Unit tests mock the SDK and therefore cannot prove the email
templates are correct. The templates are the highest-risk part of this change and are only
exercised by a real send:

1. Sign up with a throwaway address → confirmation link signs you in and lands on the board.
2. Request a password reset → link opens `/auth/reset`, a new password can be set, and it works on
   next sign-in.
3. Google OAuth still completes.
4. Sanity: `https://magicagenda.app/#access_token=<any>` no longer establishes a session.

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
