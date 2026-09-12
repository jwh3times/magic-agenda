# Runbook: recover an account locked out of two-factor

**Read this before you need it.** The first time you follow these steps should not be while someone
is locked out of their account and waiting.

v1.9.0 shipped TOTP two-factor. **Supabase issues no backup codes**, so a user who has lost their
authenticator cannot recover on their own, and both the step-up screen and the settings section say
so in as many words:

> Lost access to your authenticator? There are no backup codes — contact support to have two-factor
> removed from your account.

This is what support then does. There is no self-service path, and there is no way to add one
without building recovery codes as a feature — see [Not in scope](#not-in-scope).

**Why they cannot fix it themselves.** The step-up gate is rendered in place by both `HomeRoute` and
`ProtectedRoute`, so `/settings` — where `TwoFactorSection` would let them remove the factor — is
unreachable while the gate is up. The only control the gate offers is Sign out
(`src/auth/MfaChallenge.tsx:153`), which is deliberate: with no backup codes it is the only escape
the client can honestly offer.

- **What you need:** the project's `service_role` key (or a Supabase access token with admin rights)
  and the project ref. Both live in 1Password; the private companion's secrets manifest names the
  exact references. **Never paste a resolved value into a shared terminal, an issue, or a chat
  transcript** — resolve it through `op` at the point of use.
- **How long it takes:** about two minutes once identity is confirmed. Confirming identity is the
  slow part, and it is the part you must not rush.

## 0. Confirm identity first — the step most likely to be skipped

**Removing someone's second factor on request is the exact shape of a social-engineering attack.** An
attacker who has the password and not the phone is precisely the person two-factor is stopping, and
"I lost my authenticator, please turn it off" is what they will say. What follows is irreversible in
the sense that matters: once the factor is gone, the password alone is enough.

> **This section is a proposal and needs the maintainer's sign-off — it is the one part of this
> runbook not established by rehearsal.** Everything from step 1 onward was measured; this is a
> policy call about how much proof is enough, and it belongs to whoever carries the risk.

Suggested bar, pending that decision:

- The request must arrive from, or be confirmed by a reply to, **the account's own email address**.
  Control of that mailbox is already enough to reset the password, so requiring it concedes nothing
  that is not already conceded — but it does stop a request made from any other address.
- Do not accept the account's email address as _identification_ supplied by the requester. Look the
  account up yourself and reply to the address on file.
- Prefer a delay over a fast turnaround whenever anything is inconsistent. Nobody is harmed by
  waiting; the failure on the other side is total.

## 1. Find the account and its factors

You need the user's `auth.users` id. Look it up by email:

```bash
psql "$DB_URL" -c "select id, email, created_at from auth.users where email = 'them@example.com';"
```

Then list the factors. The admin API is the reference answer, because it is the same view GoTrue
itself has:

```bash
curl -s "$SUPABASE_URL/auth/v1/admin/users/$USER_ID/factors" \
  -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY"
```

```jsonc
// 200 — one verified TOTP factor
[
  {
    "id": "f1bfb11b-…",
    "status": "verified",
    "factor_type": "totp",
    "friendly_name": "Authenticator",
    "last_challenged_at": "2026-09-11T22:19:29.706684Z",
  },
]
```

An account with no factors returns `[]`, not an error. The equivalent client call is
`supabase.auth.admin.mfa.listFactors({ userId })`.

The same rows are readable directly, which is convenient when a `psql` session is already open:

```bash
psql "$DB_URL" -c "select id, status, factor_type, friendly_name, created_at
                     from auth.mfa_factors where user_id = '$USER_ID';"
```

**A `status` of `unverified` is not a lockout.** An unverified factor is an abandoned enrolment: it
grants nothing and gates nothing, but it does count against `max_enrolled_factors` (10, in
`supabase/config.toml`). Removing one is housekeeping, not recovery. Only a `verified` factor raises
the gate.

> **Whether the Supabase dashboard shows factors per user was not verified** — that needs production
> dashboard access, which the rehearsal did not have. Both paths above are verified, so this is a
> convenience question rather than a gap in the procedure.

## 2. Remove the factor — use the admin API

```bash
curl -s -X DELETE "$SUPABASE_URL/auth/v1/admin/users/$USER_ID/factors/$FACTOR_ID" \
  -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY"
```

Or `supabase.auth.admin.mfa.deleteFactor({ id, userId })`. It returns the deleted factor. An id that
does not exist returns **404 `Factor not found`** rather than succeeding silently, so a typo fails
loudly.

**Prefer this over deleting the row directly, for a specific reason rather than superstition.** A raw
`delete from auth.mfa_factors` does work — the fresh sign-in afterwards is ungated, and
`auth.mfa_challenges` is cleaned up either way, because its foreign key to `auth.mfa_factors` is
`ON DELETE CASCADE`. But **`auth.mfa_amr_claims` has no foreign key to `auth.mfa_factors` at all**, so
the raw delete leaves the stale `totp` claim behind on the user's existing sessions, where the admin
API removes it. Measured both ways in the rehearsal below: API path 1 → 0 claims, SQL path 1 → 1.

That leftover grants nothing by itself — it is a record on a session that expires anyway, and a fresh
sign-in is ungated regardless. Use the SQL delete if the admin API is unavailable; just know it
leaves a trace GoTrue would have cleaned up, and say so if you do.

```bash
# Fallback only.
psql "$DB_URL" -c "delete from auth.mfa_factors where id = '$FACTOR_ID';"
```

## 3. Tell the user to sign out and sign back in

**This step is not optional, and it is the one that surprises.** `getAssuranceLevel()` is a _local_
read — it decodes the stored JWT and the session's own factor list, with no network round trip
(`src/auth/AuthProvider.tsx:126`). So a user sitting on the step-up screen when you remove their
factor **stays on it**: their token still lists the factor, so the gate (`stepUpRequired`,
`src/auth/mfa.ts:60`) still reads `next: 'aal2'`.

Measured: immediately after removal the same session still reported
`{ currentLevel: 'aal1', nextLevel: 'aal2' }` and remained gated. After a session refresh it reported
`{ currentLevel: 'aal1', nextLevel: 'aal1' }` and did not.

So the fix reaches them one of two ways:

1. **Sign out and back in** — the button on the gate screen does exactly this. Tell them to press it.
2. **Wait for the token to refresh** (roughly hourly), which clears it with no action at all.

Give them the first instruction. The second is why a user who wandered off and came back will report
that it "fixed itself".

## 4. Verify the recovery

Do not stop at "the row is gone" — confirm the gate is actually down.

1. No factors remain:

   ```bash
   curl -s "$SUPABASE_URL/auth/v1/admin/users/$USER_ID/factors" \
     -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY"   # -> []
   ```

2. Ask the user to confirm they can sign in with their password alone and land on the board rather
   than the code prompt. That is the real acceptance test, because it exercises the same local
   assurance read the gate itself uses.

3. Encourage them to enrol again from **Settings → Two-factor authentication**, and to keep the
   secret somewhere they will still have it if the device is lost. There are no backup codes; the
   next lockout costs another one of these.

## Rehearsal record — 2026-09-11

Rehearsed end to end against a local stack (`npm run test:rls:up`), not against production. A
throwaway account was created, a TOTP factor enrolled and verified with a generated code, the account
confirmed gated, then recovered. What it established:

| Question                                   | Answer                                                                               |
| ------------------------------------------ | ------------------------------------------------------------------------------------ |
| Does `admin.mfa.deleteFactor` work?        | Yes. Returns the deleted factor; 404 `Factor not found` for an unknown id            |
| Does a raw SQL delete leave GoTrue broken? | No, but it leaves a stale `totp` `auth.mfa_amr_claims` row that the API path removes |
| Are `auth.mfa_challenges` rows orphaned?   | No — that foreign key is `ON DELETE CASCADE`, so both paths clean up                 |
| Is the user unblocked immediately?         | **No.** The existing session still reads `aal2` until it refreshes or they sign out  |
| Is a fresh sign-in ungated?                | Yes, by either removal path                                                          |

Not covered, and worth knowing: this was never run against production, and the Supabase dashboard's
own view of a user's factors was not checked.

## Not in scope

- **Adding backup or recovery codes.** Supabase does not issue them. That is a feature with its own
  storage and threat model, not a fix to this procedure.
- **Gating RLS on `aal2`.** Deliberately out of scope per #272: enrolling does not currently harden
  the data boundary — RLS keys on `auth.uid()` alone — and changing that is its own decision. It is
  also why a failed assurance read fails _open_: a user held behind a gate they could not pass would
  have no way back into their own account.
