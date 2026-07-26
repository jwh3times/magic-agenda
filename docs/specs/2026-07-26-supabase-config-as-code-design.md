# Supabase Config as Code — Design

- **Date:** 2026-07-26
- **Status:** Shipped as v1.2.20 (PR #93, config + workflows) and v1.2.21 (PR #94, email templates),
  both 2026-07-26
- **Drives:** Follow-ups 1 and 2 of
  [`2026-07-25-pkce-auth-flow-design.md`](2026-07-25-pkce-auth-flow-design.md) — reconcile
  `supabase/config.toml` with production so `supabase config push` is safe, then move the two
  auth email templates into the repo and deploy them from CI.

## Problem

`supabase/config.toml` is the stock `supabase init` file and has never described production. The
PKCE spec documented six drifted values; exploration for this design found two more dangerous
gaps it missed:

| `config.toml` today | Production | Risk if pushed as-is |
|---|---|---|
| `site_url = "http://localhost:5173"` | `https://magicagenda.app` | Breaks prod auth entirely |
| `additional_redirect_urls` = 2 localhost entries | prod + localhost + `/auth/confirm` entries | Wipes the allow-list |
| `minimum_password_length = 6` | 10 | Reverts 2026-06-30 hardening |
| `password_requirements = ""` | lower+upper+digit+symbol | Reverts complexity rule |
| `enable_confirmations = false` | on | Disables email confirmation |
| `secure_password_change = false` | on | Reverts require-recent-login |
| **no `[auth.external.google]` block at all** | **Google OAuth live, client id + secret** | **Could disable Google sign-in** |
| **`[auth.email.smtp]` commented out** | **Resend SMTP live (2026-07-25)** | **Could revert to the default provider — re-locking templates (free-tier restriction) and dropping the 30/hr limit** |
| `[auth.rate_limit] email_sent = 2` | 30 (custom-SMTP value) | Rate-limits auth email to 2/hr |
| [auth.mfa.totp] enroll/verify = false | TOTP enabled | Would disable authenticator-app MFA enrollment |

Meanwhile the two auth email templates exist only in the dashboard, edited by hand on
2026-07-25. ROADMAP 5.7 (branded emails) will edit them again; without templates-as-code every
edit is an untracked manual dashboard change.

## What exploration established (verified 2026-07-26)

- `supabase config push` (CLI v2) has **no `--dry-run` flag**; its only own flag is
  `--project-ref`. There is a **global `--yes`** ("Answer yes to all prompts").
- **Closed stdin is NOT a safe preview**: the CLI's confirmation prompts default to **yes on EOF** (`PromptYesNo(…, true)` in the CLI source; its integration tests assert a push proceeds on empty non-TTY stdin). The safe preview is a **piped decline stream** — `yes n | supabase config push` — which the CLI's own tests confirm declines without applying. The declined prompt lines are the preview: each names a service with pending changes. (Corrected 2026-07-26 after review caught the original abort-at-prompt assumption as false.)
- **Absent-key semantics are undocumented** (docs and CLI reference both silent on whether keys
  missing from the file are left alone or reset to defaults). This design does not depend on the
  answer: every remotely-managed `[auth]` key is set explicitly, and PR 1 is engineered to be a
  **no-op probe** — its preview must show no changes before it merges, which empirically reveals
  the semantics at zero stakes.
- Jerry never runs the local Supabase stack (`supabase start`), so `config.toml` can describe
  production outright; nothing local depends on the localhost values.
- Both required secrets are available to add as GitHub Actions repo secrets (Google OAuth client
  secret; Resend API key), joining the three Supabase secrets `deploy-migrations.yml` already
  uses.
- The PR-1 final review caught one value the Gate-1 inventory missed: **TOTP MFA is enabled in
  production** (dashboard-verified 2026-07-26) while the stock file said disabled — reinforcing
  the everything-explicit rule.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Rollout shape | **Two staged PRs** | PR 1 (reconcile + automation) merges as a proven no-op, revealing push semantics safely; PR 2 (templates) then rides a proven pipeline with a small, expected diff. One PR would debut the workflow and change live email flows on the same merge. |
| Values strategy | **`config.toml` describes production; everything explicit** | Neutralizes the undocumented absent-key behavior for `[auth]`; the local stack is unused so nothing is sacrificed. |
| Secrets | **`env()` substitution; two new repo secrets** | `GOOGLE_OAUTH_CLIENT_SECRET` and `RESEND_API_KEY`. The Google client **id** is not a secret and is committed in plain text. All *unused* stock `env()` references (Apple example, Twilio token) are deleted so the only env() refs this change adds are the two secrets (pre-existing local-only refs remain in [studio] and [experimental]). |
| Preview mechanism | **`yes n \| config push` decline-stream in a CI job** | No `--dry-run` exists; EOF auto-confirms, so a decline stream is the only safe non-applying form; prompt lines enumerate pending services. Output goes to the job summary for human review on every PR that touches config. |
| Unmanaged templates | **Only `confirmation` and `recovery` move to code** | The other templates (magic link, invite, email change) are stock defaults in prod — even a reset-to-default is a no-op, and the app sends none of them. |

## Design

### PR 1 — reconcile `config.toml` + automation

**`supabase/config.toml`** (auth-relevant sections; non-auth sections unchanged):

```toml
[auth]
site_url = "https://magicagenda.app"
additional_redirect_urls = [
  # Mirror of the dashboard allow-list — transcribed at the values-inventory gate.
  # Prod + localhost entries for /auth/callback, /auth/reset, /auth/confirm (+ any
  # Pages-preview origins present in the dashboard).
]
minimum_password_length = 10
password_requirements = "lower_upper_letters_digits_symbols"
# jwt_expiry, refresh-token settings, signup toggles: transcribed prod values.

[auth.rate_limit]
email_sent = 30
# remaining keys: transcribed prod values.

[auth.email]
enable_signup = true
double_confirm_changes = true
enable_confirmations = true
secure_password_change = true
max_frequency = "1s"        # transcribe actual
otp_length = 6
otp_expiry = 3600           # transcribe actual (noted ~1h at the PKCE Task 5 gate)

[auth.email.smtp]
enabled = true
host = "smtp.resend.com"
port = 465
user = "resend"
pass = "env(RESEND_API_KEY)"
admin_email = "no-reply@magicagenda.app"
sender_name = "Magic Agenda"

[auth.external.google]
enabled = true
client_id = "<prod client id — plain text, not a secret>"
secret = "env(GOOGLE_OAUTH_CLIENT_SECRET)"
```

Deletions: the `[auth.external.apple]` example block and the `[auth.sms.twilio]` `env()` token
line (provider disabled; a dangling `env()` reference must not be able to fail a workflow).
Every `<transcribe>` placeholder above is filled at the **values-inventory gate** (manual,
below) before the PR is written — the committed file contains only real values.

**`.github/workflows/deploy-auth-config.yml`** — mirrors `deploy-migrations.yml`:

- `on: push: branches: [main], paths: ['supabase/config.toml', 'supabase/templates/**']` +
  `workflow_dispatch`; `permissions: contents: read`; `concurrency: deploy-auth-config`,
  `cancel-in-progress: false`.
- Env: the three existing Supabase secrets + `RESEND_API_KEY` + `GOOGLE_OAUTH_CLIENT_SECRET`.
- Steps: checkout → `supabase/setup-cli@v3` → `supabase link --project-ref …` →
  `supabase config push --yes`.

**`Config` job in `ci.yml`** — the PR preview:

- **Always runs** (this repo's rule: a required check that skips wedges PRs). First step
  computes whether `git diff origin/main...HEAD` touches `supabase/config.toml` or
  `supabase/templates/**`; if not, it exits 0 with "no config changes".
- Otherwise: setup-cli → link → `yes n | supabase config push` (decline-stream, no `--yes`), capturing
  output. The step succeeds when declined prompts appear in the output or no prompts at all (no-op); it fails on
  auth/parse/`env()` errors. The captured output is written to `$GITHUB_STEP_SUMMARY` so the
  pending changes are readable in the PR checks UI.
- Same five env vars (PR-triggered runs on same-repo branches receive secrets; this is a
  single-maintainer repo — fork PRs are out of scope).

**Also in PR 1:** add both new env vars to `deploy-migrations.yml` (its `link` parses
`config.toml`, which now contains `env()` references), and check the deploy-functions workflow
for the same need. One-line status correction to the PKCE spec header ("shipped as v1.2.19",
folded in here to avoid a doc-only release).

**Merge gate:** the `Config` preview on PR 1 must show **no pending changes**. Any diff means a
transcription error or an absent-key surprise — fix the file until the preview is clean, then
merge. Post-merge: `Deploy Auth Config` runs (expected no-op); smoke prod sign-in, Google OAuth,
and one reset email.

### PR 2 — templates as code

- `supabase/templates/confirmation.html` and `supabase/templates/recovery.html` — current
  dashboard HTML, exported verbatim at the template-export gate, links already in the
  shipped form `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=signup` / `…&type=recovery`.
- `config.toml` gains:

```toml
[auth.email.template.confirmation]
subject = "<current dashboard subject>"
content_path = "./supabase/templates/confirmation.html"

[auth.email.template.recovery]
subject = "<current dashboard subject>"
content_path = "./supabase/templates/recovery.html"
```

- **Merge gate:** the `Config` preview must show **exactly** the two template blocks as the
  pending change, nothing else. Post-merge: the workflow applies them; verify one signup email
  and one reset email still arrive with `token_hash` links and unchanged rendering.
- After this lands, ROADMAP 5.7 restyling is normal PR work against the HTML files.

### After both PRs — make `Config` required

Add `Config` to the required status checks via the repository ruleset (id 18273908 —
"Main/Release branch rules"; edit with `gh api -X PUT repos/jwh3times/magic-agenda/rulesets/18273908`
sending the full rules array). Done **after** PR 1 is on main, never before — the job must exist
on main before it is required.

## Manual gates (Jerry, in order)

1. **Values inventory + secrets** (before PR 1 is written): transcribe from the dashboard the
   exact redirect allow-list, JWT/refresh settings, rate limits, OTP settings, and the Google
   client id; add `GOOGLE_OAUTH_CLIENT_SECRET` and `RESEND_API_KEY` as Actions repo secrets.
2. **PR 1 preview review**: confirm the `Config` job summary shows no pending changes before
   merging.
3. **Post-PR-1 smoke**: password sign-in, Google OAuth, one reset email.
4. **Template export** (before PR 2): copy both templates' subject + HTML out of the dashboard.
5. **PR 2 preview review**: exactly the two template blocks pending.
6. **Post-PR-2 smoke**: one signup email + one reset email, rendering and links intact.
7. **Flip `Config` to required** (or hand me the go-ahead to edit the ruleset).

## Error handling

- The preview job's only subtlety is distinguishing declined-prompts (success, the preview) and clean no-op (success) from real failure
  (bad token, unresolved `env()`, TOML parse error) — decided by output pattern, not exit code
  alone.
- A failed `Deploy Auth Config` run on main leaves prod untouched or partially updated per the
  CLI's own semantics; recovery is re-run via `workflow_dispatch` (idempotent — push converges
  on the file) or dashboard correction. Both PRs' changes remain dashboard-reversible at all
  times.
- If PR 1's preview reveals that push manages settings this design didn't anticipate (e.g. it
  wants to change `[api]` values), the diff is visible pre-merge; extend the file's explicit
  values and re-preview rather than merging a surprise.

## Testing

No app code changes; the CI jobs are the tests. Local verification before pushing each PR:
`npx tsc -b` is irrelevant here — instead, TOML sanity (the CLI parses the file during the
preview job) and `scripts/check-changelog.mjs` via the ship flow. The one local check worth
running: `npx supabase gen types --linked > /dev/null` after PR 1's file lands locally, to
confirm the CLI still tolerates the `env()` references for read-only commands without those env
vars set (expected: warning at most; if it errors, document `export RESEND_API_KEY=dummy` in
AGENTS.md as part of PR 1).

## Rollback

- Either PR: `git revert` → the deploy workflow pushes the previous config back. Templates and
  every auth setting also remain editable in the dashboard at all times (a dashboard edit then
  drifts from the file — reconverged on the next push, so prefer revert-and-merge).

## Out of scope

- Managing non-auth config sections as code beyond leaving them untouched (api/db/storage values
  stay as the stock file wrote them; the PR 1 preview will reveal whether push even considers
  them — handled per "Error handling" if so).
- Branded email styling (ROADMAP 5.7) — becomes easy after PR 2, but is its own change.
- The other carried-over security-review items (HIBP — Pro-gated; Pages preview redirect
  wildcard).
- Fork-PR secret handling for the `Config` job (single-maintainer repo).

## Follow-ups this spec creates

1. ROADMAP 5.7 can now be scheduled as ordinary PR work (edit the HTML files).
2. If the PR 1 preview reveals push manages more surface than `[auth]`, consider a later PR
   extending explicit values to those sections (api, db pooler, network restrictions).
