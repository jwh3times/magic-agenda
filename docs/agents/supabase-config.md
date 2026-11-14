# When changing Supabase config

The five `supabase/setup-cli` steps in `.github/workflows/` **derive** their CLI version from the
exact `supabase` devDependency at run time (an `id: cli` step reading `package.json` into
`$GITHUB_OUTPUT`), so a Dependabot bump of the CLI needs no workflow edit. It used to be written out
by hand in five places, which made every such bump red on arrival and stuck — the bot cannot edit
workflows, so the PR stayed failing until someone aligned them (#335, fixed by #338). Two things
follow. **The devDependency must stay an exact version**: setup-cli takes a bare version string, so
a range would be passed straight through and fail at install time, and nothing else in the repo
requires that pin to be exact — `scripts/workflow-pins.test.ts` is what does. And that test now
asserts the **wiring** rather than a literal, checking the producer step as well as the input,
because a version expression naming a step that does not exist resolves to the empty string, which
setup-cli reads as "latest". Actions still use full commit SHAs with version comments, updated
through Dependabot’s `github-actions` ecosystem; this changed the `version:` input only, never a
`uses:` reference.

`supabase/config.toml`'s `[auth]` tree describes **production** exactly (site URL, redirect
allow-list, password policy, OTP settings, rate limits, the Resend SMTP block, the Google OAuth
block, Turnstile, TOTP MFA), `[api].auto_expose_new_tables = false` keeps automatic Data API grants off,
`[db.ssl_enforcement].enabled = true` requires TLS for database and pooler connections, and
`[db.pooler]`'s `pool_mode`, `default_pool_size` and `max_client_conn` are production's pooler
settings. **Supabase CLI v3's `config push` pushes those three pooler keys, which v2 never did**;
the block's `enabled` and `port` still configure only the local stack (checked against the v3
CLI's push mapping, #647). The two sizes were the `supabase init` defaults (20 / 100) until #640's
first `config diff` showed production running 15 / 200 — merging the defaults would have halved
production's client-connection limit. Every edit is a production change, not local scaffolding.

Changes to `supabase/config.toml` or `supabase/templates/**` **auto-apply to production on merge to
`main`** via the `Deploy Auth Config` workflow (`.github/workflows/deploy-auth-config.yml`, which
runs `supabase config push --yes`). The `Config` CI job previews the pending push on PRs that touch
those paths with the read-only `supabase config diff --exit-code` (exit 0: the remote matches the
file; exit 2: the printed diff is pending).

Production also has two settings the file leaves undeclared on purpose.

**Leaked-password protection** (Pro, #276) has no `config.toml` key at all: the config-to-API
mapping of Supabase CLI 3.x (checked on 3.0.0 and 3.1.0) covers `minimum_password_length` and
`password_requirements` but not the Management API's `password_hibp_enabled`. So `config push` can
neither set nor clear it, and it is changed in the dashboard by the operator. Unlike image
transformation below, `config diff` has nothing to compare it with either, so it never appears in
the diff, not even as `remote-only`: an absent line says nothing about whether it is on. Verify it
by reading `password_hibp_enabled` from the Management API's auth config. If a later CLI adds a key
for it, declare it `true` and expect a `Config` diff of nothing.

**Image transformation**, `storage.image_transformation.enabled = true` (a Pro-plan feature), is
declarable but left out. `config push` pushes only declared settings that differ (`update`) or that
production lacks (`local-only`), never a `remote-only` one, so leaving it out keeps it as it is.
Declaring it would cost either way: `true` turns image transformation on for a full local
`supabase start` too, and `false` would turn it off in production on merge. Every `config diff`
lists it as the one `remote-only` line, and that line is expected.

**Requiring the current password**, `auth.email.require_current_password = true`, is declared even
though production already had it on (#663). Supabase CLI 3.1.0 began comparing the key, and while
the file left it at the default `false`, every diff carried it as a second `remote-only` line.
Declaring it costs nothing the app can see: the only password write is `ResetPassword`, and
Supabase Auth skips the check for a recovery session and for an Account that has no password yet,
the only two sessions that page serves. The local stack and E2E now run with it on, as production
does. A future in-session "change password" form would have to send the current password.

**A green `Config` check means the diff ran, not that nothing is pending.**
`scripts/config-preview.sh` passes on exit 2 as well as on exit 0, because the printed diff is the
preview; #646's first `Config` run was green and listed three production changes. So on a PR that
changes `supabase/config.toml`, `supabase/templates/**` or the Supabase CLI's major version, read
the diff in the job log or summary before merging: each `update` and `local-only` line is what the
merge will push, and only the `storage.image_transformation` line above should be `remote-only`.
The job diffs only when the PR touches the config paths and is not Dependabot's (Dependabot PRs get
no secrets), and `Deploy Auth Config` deploys only on the same paths. So a CLI bump that touches
neither is green without any diff, and its first push comes with the next config merge. Carry a
CLI-major bump on a branch of your own that also changes `config.toml`, even a comment, as #646
did, so its `Config` check shows what the new CLI would push; a Dependabot PR for it gets no diff
whatever it touches.

Until Supabase CLI v3 the `Config` job declined `config push` prompts
with `yes n |`; v3 ignores answers piped on stdin and fails an unattended push without `--yes`
(`HostedMutationConsentRequiredError`), so that preview stopped working (#640). **The preview is
bounded and retried (#429)** in `scripts/config-preview.sh`, because a hung CLI once held this
required check for GitHub's six-hour default:

- Each attempt runs under `timeout --kill-after` (3 minutes) with stdin closed, and the job carries
  `timeout-minutes: 15`.
- A failed attempt (the rate-limit case) is retried up to three times, with backoff, as the same
  read-only diff.
- A timeout always fails the check.
- `scripts/config-preview.test.ts` covers each outcome with fake commands.

**Since v3, `SUPABASE_*` environment variables override `config.toml`, and `config push` pushes
them** (resolution order: flag > shell env > project env files > `config.toml`). The `Config` and
`Deploy Auth Config` jobs set only credentials and the target (`SUPABASE_ACCESS_TOKEN`,
`SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_ID`; the ref also overrides `config.toml`'s
`project_id`, which only names local containers and is not pushed) plus `SUPABASE_ENV=production`,
which keeps a `.env.development` file, should one ever be committed, from applying. A committed
`.env` or `.env.local` would load whatever `SUPABASE_ENV` says, so none may be tracked (today only
`.env.example` is). Every deploy workflow and the backup set the same `SUPABASE_ENV`. Adding another `SUPABASE_*` variable to either job is a
production config change: `config diff` labels values an env var supplies, so the preview shows it.

**Hosted targets are explicit since v3.** `db push`, `db dump` and `gen types` target the local
stack unless given `--remote`; `functions deploy` and `config push` are remote-only but, like
`db push`, fail unattended without `--yes`. The deploy workflows run `supabase link <ref>` then
`db push --remote --yes`, `functions deploy --remote=<ref> --yes` and `config push --yes`; the
backup runs `db dump --remote`. The deprecated `--linked` / `--project-ref` forms still work but
warn, and are not used here. Secrets referenced via `env(...)` in the file (`RESEND_API_KEY`,
`GOOGLE_OAUTH_CLIENT_SECRET`, `TURNSTILE_SECRET_KEY`) exist only as repository secrets, used by both the `Config` and
`Deploy Auth Config` jobs; `deploy-migrations.yml` and `deploy-functions.yml` also carry them so
the CLI's config.toml parsing on every command can't fail on a missing var. **Never run
`supabase config push` locally** — it deploys straight to production, bypassing the PR preview.

Turnstile has two distinct deployment inputs. `TURNSTILE_SECRET_KEY` is an Actions repository
secret used only while Supabase CLI parses and deploys `[auth.captcha]`; every workflow that parses
the config must provide it, while `scripts/rls-up.mjs` and the RLS CI job deliberately replace it
with a dummy for the local stack. `VITE_TURNSTILE_SITE_KEY` is public browser configuration and must
exist in both the Production and Preview environments of the Cloudflare Pages project. CI uses a
placeholder site key because its build is hermetic. A config merge enables server-side validation,
so do not merge the code before both real deployment inputs are provisioned.

**Deleting an Edge Function from this repository does not delete it from production.**
`supabase functions deploy` with no name deploys every function under `supabase/functions/`; it
does not prune, and a directory that is gone is simply one it no longer has a source for. So
removing a function here leaves the last-deployed copy live and serving, on whatever `verify_jwt`
it was deployed with, and with no source in the repository to review it against. Retiring one is
therefore two acts, and the second is not something a merge can do: a
`supabase functions delete <name> --remote=<ref>` run by someone holding the access token,
which lives only as a repository secret. Plan both halves together — the merge on its own is the
half that looks finished.
The two auth email templates the app sends (confirm-signup, reset-password) live in
`supabase/templates/{confirmation,recovery}.html` and deploy the same way — edit the HTML files,
never the dashboard, which is no longer the source of truth for them. Three constraints on those
files: (1) the action link must stay exactly
`{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=recovery|signup` — raw `&`, not `&amp;` —
because `ResetPassword` / `AuthConfirm` redeem it with `verifyOtp`; (2) they are **email**, so
table layout and inline styles only (no flexbox/grid, webfonts, gradients, or SVG), and the
`color-scheme: dark` meta pair is what stops dark-mode clients re-inverting the already-dark
design; (3) **the whole file is pushed as the email body**, comments included — keep comments to a
line, since anything here ships to every recipient's inbox.
