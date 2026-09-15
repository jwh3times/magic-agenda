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
and `[db.ssl_enforcement].enabled = true` requires TLS for database and pooler connections.
Every edit is a production change, not local scaffolding. Changes to
`supabase/config.toml` or `supabase/templates/**` **auto-apply to production on merge to `main`**
via the `Deploy Auth Config` workflow (`.github/workflows/deploy-auth-config.yml`, which runs
`supabase config push --yes`). The `Config` CI job previews the pending push on PRs that touch
those paths using `yes n | SUPABASE_YES=false supabase config push --agent no --output-format text`
to decline confirmation prompts. Keep the explicit text mode: machine-readable output skips prompts
and accepts their defaults even with `yes n` on stdin. The CLI has no `--dry-run`, and prompts also
default to **yes** on EOF. Secrets referenced via `env(...)` in the file (`RESEND_API_KEY`,
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
`supabase functions delete <name> --project-ref <ref>` run by someone holding the access token,
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
