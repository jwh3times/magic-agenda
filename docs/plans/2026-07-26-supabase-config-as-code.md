# Supabase Config as Code Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **MANUAL GATES:** Tasks 1, 6, 7, 10, and 11 need Jerry (dashboard values, secrets, merge
> decisions, smoke tests, ruleset change). At each gate the orchestrator MUST stop, present the
> checklist to Jerry in the main session, and WAIT for confirmation. Task 2's file content
> depends on Gate 1's answers — the orchestrator inserts the recorded values into the Task 2
> dispatch.

**Spec:** `docs/specs/2026-07-26-supabase-config-as-code-design.md` (the authority — read it first)

**Goal:** Make `supabase/config.toml` describe production so `supabase config push` is safe, wire
push into CI (PR preview + deploy-on-main), then move the two auth email templates into the repo.

**Architecture:** Two staged PRs. PR 1 (branch `chore/supabase-config-as-code`, already holding
the spec) reconciles the config and adds the automation; its CI preview must show a **no-op**
before merge — that first merge safely probes the CLI's undocumented absent-key semantics. PR 2
(branch `chore/auth-templates-as-code`) adds the two template files and blocks, riding the proven
pipeline with an exactly-known diff.

**Tech Stack:** Supabase CLI v2 (`config push`; no `--dry-run` — preview = `yes n |` decline stream; EOF auto-confirms, so closed stdin is unsafe), GitHub Actions, TOML. No app code.

## Global Constraints

- **NEVER run `supabase config push` locally or with `--yes` outside the deploy workflow.** The
  preview job and the deploy workflow are the only places push executes. This is the whole
  point of the design.
- Secret VALUES never pass through chat or the repo: Jerry adds them via `gh secret set` in his
  own terminal or the GitHub UI. The repo only ever contains `env(RESEND_API_KEY)` /
  `env(GOOGLE_OAUTH_CLIENT_SECRET)` references.
- Existing secrets already set: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`,
  `SUPABASE_PROJECT_ID`. New in this plan: `RESEND_API_KEY`, `GOOGLE_OAUTH_CLIENT_SECRET`.
- `main` is PR-only; every merge releases — each PR's changelog entry names the version computed
  by `scripts/next-version.mjs` at ship time (the `ship` skill owns this).
- Workflows follow the repo's existing style: `permissions: contents: read`, a `concurrency`
  group with `cancel-in-progress: false` for deploys, explanatory header comments.
- No `src/**` changes anywhere in this plan (`format:check`/`lint`/`tsc` are unaffected; CI's
  `Test`/`Build` jobs stay green by construction).
- A required check must always report a status → the new `Config` job always runs and
  early-exits when config paths are untouched; it is added to the required list only AFTER it
  exists on `main` (Task 11), never before.

---

### Task 1: MANUAL GATE — values inventory + secrets (Jerry)

- [ ] **Step 1: STOP and prompt Jerry with exactly this checklist; record every answer:**

> **A. Transcribe from the Supabase dashboard (Authentication section):**
>
> 1. **URL Configuration:** Site URL, and the complete Redirect URLs list (every entry, verbatim).
> 2. **Providers → Email:** Confirm email ON/OFF, Secure email change ON/OFF, Secure password
>    change ON/OFF, Minimum password length, Password requirements (which complexity option),
>    Email OTP expiration (seconds), Email OTP length.
> 3. **Providers → Google:** the **Client ID** (the long `….apps.googleusercontent.com` string —
>    this is not a secret; paste it here). Leave the secret in the dashboard.
> 4. **Rate limits:** every value on the Auth rate-limits page (emails/hour, SMS/hour, anonymous
>    sign-ins, token refreshes, sign-ups, token verifications, Web3).
> 5. **Sessions (if the page exists):** time-box / inactivity timeout (expected: not set).
> 6. **SMTP settings:** sender email + sender name as saved (expected `no-reply@magicagenda.app`
>    / `Magic Agenda`), host, port.
> 7. **Auth → Email Templates:** do NOT copy them yet (that's Gate 7); just confirm which
>    templates differ from stock (expected: Confirm signup and Reset password only).
>
> **B. Add the two new repo secrets yourself (values must not pass through chat):**
>
> ```
> gh secret set RESEND_API_KEY               # paste the Resend API key when prompted
> gh secret set GOOGLE_OAUTH_CLIENT_SECRET   # from dashboard Google provider / GCP console
> ```
>
> Confirm with `gh secret list` (should show 5 secrets).

- [ ] **Step 2: Record the transcribed values in the run ledger** (they parameterize Task 2) and
      do not proceed until both secrets show in `gh secret list`.

---

### Task 2: Reconcile `supabase/config.toml` to production

**Files:**

- Modify: `supabase/config.toml` (the `[auth]`… sections only; `[api]`/`[db]`/`[storage]`/
  `[realtime]`/`[studio]`/`[local_smtp]`/`[edge_runtime]` untouched)

**Interfaces:**

- Consumes: the Gate 1 value inventory (orchestrator inserts real values into this dispatch).
- Produces: a `config.toml` whose `[auth]` tree exactly describes production; the only `env()`
  references this change leaves in the [auth] tree are `RESEND_API_KEY` and
  `GOOGLE_OAUTH_CLIENT_SECRET` (pre-existing [studio]/[experimental] refs are out of scope).

- [ ] **Step 1: Apply the edits.** With `<G1:…>` meaning "the value recorded at Gate 1":

1. `[auth]`: `site_url = "https://magicagenda.app"`; `additional_redirect_urls = [ <G1:full
redirect list, one quoted string per entry> ]`; `minimum_password_length = <G1>` (expected 10);
   `password_requirements = "<G1>"` (expected `lower_upper_letters_digits_symbols`); leave
   `jwt_expiry`, `enable_refresh_token_rotation`, `refresh_token_reuse_interval`,
   `enable_signup`, `enable_anonymous_sign_ins`, `enable_manual_linking` at current file values
   unless Gate 1 showed different dashboard values.
2. `[auth.rate_limit]`: set every key to `<G1>` values (expected change: `email_sent = 30`).
3. `[auth.email]`: `enable_confirmations = true`; `secure_password_change = true`;
   `double_confirm_changes = <G1:secure email change>`; `otp_expiry = <G1>`;
   `otp_length = <G1>`; keep `enable_signup = true`, `max_frequency = "1s"` unless Gate 1
   differs.
4. Insert after `[auth.email]`'s keys, replacing the commented `[auth.email.smtp]` example:

```toml
# Production email goes through Resend (configured 2026-07-25; free tier).
# The API key is a GitHub Actions secret; env() resolves it in the deploy workflows.
[auth.email.smtp]
enabled = true
host = "smtp.resend.com"
port = 465
user = "resend"
pass = "env(RESEND_API_KEY)"
admin_email = "no-reply@magicagenda.app"
sender_name = "Magic Agenda"
```

5. Replace the `[auth.external.apple]` example block (delete it entirely, including its
   comments) with:

```toml
# Google OAuth is the only external provider. The client id is public by design;
# the secret is a GitHub Actions secret resolved by env() in the deploy workflows.
# This block MUST stay explicit: config push semantics for absent keys are
# undocumented, and an absent block risks disabling Google sign-in in production.
[auth.external.google]
enabled = true
client_id = "<G1:google client id>"
secret = "env(GOOGLE_OAUTH_CLIENT_SECRET)"
```

6. In `[auth.sms.twilio]`, change `auth_token = "env(SUPABASE_AUTH_SMS_TWILIO_AUTH_TOKEN)"` to
   `auth_token = ""` (provider disabled; a dangling `env()` must not be able to fail a
   workflow). Keep the block's DO-NOT-COMMIT comment.

- [ ] **Step 2: Verify the CLI still parses the file without the new env vars set** (read-only
      command; also regression-checks generated types):

Run: `npx supabase gen types typescript --linked > "$TEMP/gen-types-check.ts" && node -e "const fs=require('fs');const a=fs.readFileSync('src/types/database.types.ts','utf8');const b=fs.readFileSync(process.env.TEMP+'/gen-types-check.ts','utf8');process.exit(a.trim()===b.trim()?0:1)" && echo TYPES-MATCH`
Expected: `TYPES-MATCH`, possibly with CLI warnings about unset env vars (warnings are fine).
If the CLI **errors** on the unresolved `env()` refs instead: append to AGENTS.md's Commands
section the one-liner `` `RESEND_API_KEY=dummy GOOGLE_OAUTH_CLIENT_SECRET=dummy npx supabase gen types …` `` (documenting that read-only CLI use needs dummy values), and include that edit in this task's commit.

- [ ] **Step 3: Commit**

```bash
git add supabase/config.toml
git commit -m "chore: reconcile supabase config.toml with production auth settings"
```

(Append the standard footer used by this repo's agent commits.)

---

### Task 3: Deploy workflow + env vars for existing workflows

**Files:**

- Create: `.github/workflows/deploy-auth-config.yml`
- Modify: `.github/workflows/deploy-migrations.yml` (env block)
- Modify: `.github/workflows/deploy-functions.yml` (env block)

**Interfaces:**

- Consumes: the reconciled `config.toml` (Task 2) with its two `env()` references.
- Produces: `Deploy Auth Config` workflow that Task 6/10's merges trigger; migrations/functions
  workflows immune to the new `env()` refs.

- [ ] **Step 1: Create `.github/workflows/deploy-auth-config.yml`:**

```yaml
name: Deploy Auth Config

# Applies supabase/config.toml (and the email templates it references) to the
# production project automatically when either changes on `main`.
#
# Requires the repository secrets used by Deploy Migrations plus two more:
#   RESEND_API_KEY               - resolves env(RESEND_API_KEY) in [auth.email.smtp]
#   GOOGLE_OAUTH_CLIENT_SECRET   - resolves env(GOOGLE_OAUTH_CLIENT_SECRET) in [auth.external.google]
#
# `supabase config push --yes` converges the remote project on the file, so
# re-runs are safe. The PR-side preview of the same push lives in ci.yml (Config job).

on:
  push:
    branches: [main]
    paths:
      - 'supabase/config.toml'
      - 'supabase/templates/**'
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: deploy-auth-config
  cancel-in-progress: false

jobs:
  Deploy:
    runs-on: ubuntu-latest
    env:
      SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
      SUPABASE_DB_PASSWORD: ${{ secrets.SUPABASE_DB_PASSWORD }}
      SUPABASE_PROJECT_ID: ${{ secrets.SUPABASE_PROJECT_ID }}
      RESEND_API_KEY: ${{ secrets.RESEND_API_KEY }}
      GOOGLE_OAUTH_CLIENT_SECRET: ${{ secrets.GOOGLE_OAUTH_CLIENT_SECRET }}
    steps:
      - uses: actions/checkout@v7
      - uses: supabase/setup-cli@v3
        with:
          version: latest
      - run: supabase link --project-ref "$SUPABASE_PROJECT_ID"
      - run: supabase config push --yes
```

- [ ] **Step 2: Add the two new env lines to `deploy-migrations.yml`** — in the `Deploy` job's
      `env:` block, after `SUPABASE_PROJECT_ID`:

```yaml
# config.toml now contains env() references; the CLI parses it during link/push.
RESEND_API_KEY: ${{ secrets.RESEND_API_KEY }}
GOOGLE_OAUTH_CLIENT_SECRET: ${{ secrets.GOOGLE_OAUTH_CLIENT_SECRET }}
```

- [ ] **Step 3: Same two lines (same comment) in `deploy-functions.yml`'s `env:` block.**

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/deploy-auth-config.yml .github/workflows/deploy-migrations.yml .github/workflows/deploy-functions.yml
git commit -m "ci: deploy auth config from config.toml on merge to main"
```

---

### Task 4: `Config` preview job in `ci.yml`

**Files:**

- Modify: `.github/workflows/ci.yml` (append one job)

**Interfaces:**

- Consumes: same five secrets; the reconciled config.
- Produces: a job named `Config` that ALWAYS reports a status (required-check-safe), and on
  config-touching PRs writes the pending push diff to the job summary without applying it.

- [ ] **Step 1: Append after the `Changelog` job:**

````yaml
# Previews what `supabase config push` would change, WITHOUT applying it. The CLI
# has no --dry-run, and running it non-interactively with closed stdin is NOT safe:
# its confirmation prompts default to YES on EOF (verified against the CLI source
# and its integration tests). `yes n |` streams a decline to every prompt, so this
# job can never apply config. The prompt lines in the output ARE the preview: no
# prompts + exit 0 = remote already matches the file; each "Do you want to push…?"
# line names a service with pending changes. The real push happens in
# deploy-auth-config.yml on merge (--yes). This job always reports a status (a
# required check that skips wedges the PR — see AGENTS.md), exiting early when the
# PR doesn't touch config paths, and for Dependabot PRs (which get no secrets).
# NOTE: output patterns below were written before the first real run; PR 1 of the
# config-as-code plan is the calibration run — adjust there if wording differs.
Config:
  if: github.event_name == 'pull_request'
  runs-on: ubuntu-latest
  env:
    SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
    SUPABASE_DB_PASSWORD: ${{ secrets.SUPABASE_DB_PASSWORD }}
    SUPABASE_PROJECT_ID: ${{ secrets.SUPABASE_PROJECT_ID }}
    RESEND_API_KEY: ${{ secrets.RESEND_API_KEY }}
    GOOGLE_OAUTH_CLIENT_SECRET: ${{ secrets.GOOGLE_OAUTH_CLIENT_SECRET }}
  steps:
    - uses: actions/checkout@v7
      with:
        fetch-depth: 0
    - name: Skip when the PR touches no config paths (or author is Dependabot)
      id: paths
      env:
        PR_AUTHOR: ${{ github.event.pull_request.user.login }}
        BASE_REF: ${{ github.base_ref }}
      run: |
        set -euo pipefail
        if [[ "$PR_AUTHOR" == "dependabot[bot]" ]]; then
          echo "Dependabot PR: no secrets available; preview skipped." | tee -a "$GITHUB_STEP_SUMMARY"
          echo "changed=false" >> "$GITHUB_OUTPUT"
          exit 0
        fi
        changed_files=$(git diff --name-only "origin/${BASE_REF}...HEAD" -- supabase/config.toml 'supabase/templates/**')
        if [ -n "$changed_files" ]; then
          echo "changed=true" >> "$GITHUB_OUTPUT"
        else
          echo "No auth-config changes in this PR." | tee -a "$GITHUB_STEP_SUMMARY"
          echo "changed=false" >> "$GITHUB_OUTPUT"
        fi
    - uses: supabase/setup-cli@v3
      if: steps.paths.outputs.changed == 'true'
      with:
        version: latest
    - name: Link project
      if: steps.paths.outputs.changed == 'true'
      run: supabase link --project-ref "$SUPABASE_PROJECT_ID"
    - name: Preview config push (declines every prompt — never applies)
      if: steps.paths.outputs.changed == 'true'
      run: |
        # Never add shell: bash to this job: that turns on pipefail, and yes(1) dying of SIGPIPE would misreport config push's exit code (141) and corrupt the no-op classification.
        set +e
        out=$(yes n | supabase config push 2>&1)
        code=$?
        set -e
        {
          echo '## Pending `supabase config push` changes (each declined prompt = one pending service)'
          echo '```'
          echo "$out"
          echo '```'
        } >> "$GITHUB_STEP_SUMMARY"
        echo "$out"
        prompts=$(echo "$out" | grep -ciE 'do you want|\[y/n\]' || true)
        if [ "$code" -eq 0 ] && [ "$prompts" -eq 0 ]; then
          echo "No pending changes — remote already matches the file."
          exit 0
        fi
        if [ "$prompts" -gt 0 ]; then
          echo "Preview complete: $prompts pending change prompt(s), all declined — nothing applied."
          exit 0
        fi
        echo "config push failed before reaching any confirmation prompt."
        exit "$code"
````

- [ ] **Step 2: Sanity-check the workflow file parses** (no YAML errors):

Run: `npx --yes yaml-lint .github/workflows/ci.yml || python -c "import yaml,sys; yaml.safe_load(open('.github/workflows/ci.yml')); print('YAML OK')"`
Expected: a clean parse (either tool). If neither tool is available, `node -e` with `js-yaml`
via `npx --yes js-yaml .github/workflows/ci.yml > /dev/null && echo YAML OK`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add Config job previewing supabase config push on PRs"
```

---

### Task 5: PKCE spec status correction + ship PR 1

**Files:**

- Modify: `docs/specs/2026-07-25-pkce-auth-flow-design.md` (status line only)

- [ ] **Step 1:** In the PKCE spec header, change `- **Status:** Approved, not yet implemented`
      to `- **Status:** Shipped as v1.2.19 (PR #92, 2026-07-25)`.

- [ ] **Step 2:** Commit:

```bash
git add docs/specs/2026-07-25-pkce-auth-flow-design.md
git commit -m "docs: mark PKCE auth spec shipped (v1.2.19)"
```

- [ ] **Step 3: Invoke the `ship` skill** for PR 1. Changelog notes for the entry (Internal +
      Security flavored): config.toml now describes production (closes the "config push is a
      landmine" follow-up from the PKCE spec); new `Deploy Auth Config` workflow + `Config` PR
      preview job; two new repo secrets referenced via `env()`. Docs pass: AGENTS.md's "When
      changing the schema" / commands area may warrant one sentence on config-as-code (docs-updater
      decides); ROADMAP untouched.

- [ ] **Step 4:** Wait for all checks green. The `Config` job on this PR is the **calibration
      run** — if it fails on output-pattern matching (see Task 4 NOTE), fix the pattern in the same
      PR and re-push.

---

### Task 6: MANUAL GATE — PR 1 preview review, merge, smoke (Jerry)

- [ ] **Step 1: STOP and prompt Jerry:**

> PR 1 is green. Open the `Config` check's job summary: it must report **no pending changes**
> (either "remote already matches" or an empty diff). If it lists ANY pending change, do NOT
> merge — read it together with me: either a Gate 1 value was transcribed wrong (we fix
> config.toml) or push manages settings we didn't anticipate (we extend the file per the spec's
> error-handling rule), then re-preview.
>
> When the preview is clean: merge whenever ready (no cutover window this time — a no-op push
> changes nothing). After merge, confirm the `Deploy Auth Config` workflow run is green, then
> smoke: password sign-in, Google OAuth, and one password-reset email arriving.

- [ ] **Step 2: Record the outcome** (preview no-op confirmed, merge SHA, smoke results) in the
      ledger. If the preview showed changes: loop back to Task 2 with the diff as input (this is the
      one sanctioned re-entry in the plan).

---

### Task 7: MANUAL GATE — template export (Jerry)

- [ ] **Step 1: STOP and prompt Jerry:**

> Dashboard → Authentication → Email Templates. For **Confirm signup** and **Reset password**,
> paste here: (a) the exact Subject line, (b) the complete HTML body (source view), verbatim.
> These are not secrets. Don't edit anything in the dashboard — we're copying, not changing.

- [ ] **Step 2: Verify each pasted body contains its expected link** —
      `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=signup` (confirmation) and
      `…&type=recovery` (recovery). If either is missing, stop and reconcile with Jerry before
      proceeding (the dashboard is the source of truth for what's live).

---

### Task 8: Templates as code

**Files:**

- Create: `supabase/templates/confirmation.html`, `supabase/templates/recovery.html`
- Modify: `supabase/config.toml` (two template blocks)

**Interfaces:**

- Consumes: Gate 7's subjects + HTML; the merged PR 1 state of `config.toml`.
- Produces: template files whose `content_path`s the deploy workflow pushes.

- [ ] **Step 1: Start the second branch off fresh `main`:**

```bash
git checkout main && git pull && git checkout -b chore/auth-templates-as-code
```

- [ ] **Step 2:** Write the two files with Gate 7's HTML, byte-for-byte (no reformatting — these
      files are outside `src/`, so Prettier does not touch them; keep them out of any format run).

- [ ] **Step 3:** In `supabase/config.toml`, replace the commented
      `# [auth.email.template.invite]` example block with:

```toml
# The two templates the app actually sends. Content is version-controlled; the
# deploy-auth-config workflow pushes subject + body on merge. Restyling (ROADMAP
# 5.7) is now ordinary PR work against these files.
[auth.email.template.confirmation]
subject = "<G7:confirm-signup subject>"
content_path = "./supabase/templates/confirmation.html"

[auth.email.template.recovery]
subject = "<G7:reset-password subject>"
content_path = "./supabase/templates/recovery.html"
```

- [ ] **Step 4: Verify `content_path` resolution locally** (the CLI resolves paths relative to
      the repo root, mirroring the stock comment's `./supabase/templates/…` form): re-run the Task 2
      Step 2 gen-types check — the CLI parsing config.toml without error is the assertion here.
      Expected: `TYPES-MATCH` again.

- [ ] **Step 5: Commit**

```bash
git add supabase/templates/ supabase/config.toml
git commit -m "feat: manage auth email templates as code"
```

---

### Task 9: Ship PR 2

- [ ] **Step 1: Invoke the `ship` skill.** Changelog notes: auth email templates
      (confirm-signup, reset-password) now live in `supabase/templates/` and deploy on merge;
      dashboard edits are no longer the source of truth. Docs: AGENTS.md gains one line in the
      agents/docs or schema section pointing at `supabase/templates/` (docs-updater decides
      placement); note the ROADMAP 5.7 enablement in the changelog entry, not ROADMAP itself.

- [ ] **Step 2:** Checks green; this PR's `Config` job summary must show **exactly the two
      template blocks** as the pending diff — nothing else. Anything else pending = PR 1 left drift
      or the dashboard changed since; stop and reconcile with Jerry before the merge gate.

---

### Task 10: MANUAL GATE — PR 2 merge + smoke (Jerry)

- [ ] **Step 1: STOP and prompt Jerry:**

> PR 2 is green and its `Config` preview shows exactly the two template changes. Merge when
> ready. After the `Deploy Auth Config` run goes green: send yourself one signup confirmation
> (throwaway address) and one password-reset email. Both must arrive with the same rendering as
> before and working `token_hash` links (the deploy replayed the same HTML — this verifies the
> round-trip, not a visual change).

- [ ] **Step 2: Record outcomes in the ledger.**

---

### Task 11: MANUAL GATE + ruleset edit — make `Config` required (Jerry approves, orchestrator executes)

- [ ] **Step 1: STOP and confirm with Jerry** that he wants `Config` added to the required
      checks now that it exists on `main` (it always reports a status, so it cannot wedge PRs —
      including Dependabot's).

- [ ] **Step 2: Edit the ruleset** (id 18273908, "Main/Release branch rules" — the legacy
      branch-protection API 404s on this repo; the ruleset PUT needs the FULL rules array):

```bash
gh api repos/jwh3times/magic-agenda/rulesets/18273908 > /tmp/ruleset.json
# Append {"context": "Config"} to the required_status_checks rule's checks array:
node -e "
  const fs = require('fs');
  const rs = JSON.parse(fs.readFileSync('/tmp/ruleset.json', 'utf8'));
  const rule = rs.rules.find(r => r.type === 'required_status_checks');
  const checks = rule.parameters.required_status_checks;
  if (!checks.some(c => c.context === 'Config')) checks.push({ context: 'Config' });
  fs.writeFileSync('/tmp/ruleset-rules.json', JSON.stringify({ rules: rs.rules }));
"
gh api -X PUT repos/jwh3times/magic-agenda/rulesets/18273908 --input /tmp/ruleset-rules.json
# Verify:
gh api repos/jwh3times/magic-agenda/rulesets/18273908 --jq '[.rules[] | select(.type=="required_status_checks").parameters.required_status_checks[].context]'
```

Expected verification output includes `"Config"` alongside `Format`, `Test`, `Build`,
`Functions`, `Agents`, `Changelog`.

- [ ] **Step 3: Close out** — update the agent memory (config-as-code live; `config push` no
      longer a landmine; ROADMAP 5.7 unblocked), and confirm to Jerry that both spec follow-ups are
      done.

---

## Self-review notes

- Spec coverage: drift reconciliation (T2), env trimming (T2.6), deploy workflow (T3),
  migrations/functions env immunity (T3), always-running preview job with required-check safety
  (T4), PKCE status fix folded into a real PR (T5), no-op probe gate (T6), template export and
  link verification (T7), templates + content_path (T8), exact-diff gate (T9/10), required-check
  flip after main (T11), secrets hygiene (Global Constraints + T1), gen-types env() tolerance
  probe (T2.2/T8.4). Rollback lives in the spec and needs no task (git revert + workflow).
- The `<G1:…>`/`<G7:…>` markers are dispatch-time parameters filled from gate answers, per the
  plan header — the orchestrator, not the implementer, resolves them.
- Type-consistency: secret names, workflow names (`Deploy Auth Config`, job `Config`), branch
  names, and template paths are used identically across tasks.
