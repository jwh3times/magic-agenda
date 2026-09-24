# Backups

The free Supabase tier has **no automated backups**, so `.github/workflows/backup.yml` takes a
nightly logical dump: `schema.sql` (DDL for `public`), `storage.sql` (the attachments bucket and
its object policies — see below), plus `data.sql`, which carries **both** the
`public` and `auth` rows — `supabase db dump --data-only` includes Supabase-managed schemas even
though the schema dump excludes them. Do not "helpfully" add a separate `--schema auth` data dump;
one existed until v1.2.27 and was a strict subset that made restores fail on duplicate `auth.users`
keys. The data dump excludes `auth.sessions`, `auth.refresh_tokens`, `auth.mfa_amr_claims`,
`auth.mfa_challenges`, `auth.one_time_tokens`, and `auth.flow_state`; a restore into a fresh project
requires a new sign-in. Durable accounts, OAuth links, and enrolled MFA factors remain in the
bundle. The verify step requires `public.tasks`, `auth.users`, and `auth.identities` and refuses any
of those six excluded tables before encryption/upload. `scripts/backup.test.ts` exercises the
workflow's actual verification shell with both INSERT and COPY fixtures. Older encrypted bundles
still contain the auth state captured when they were made; this change does not rewrite them.

**`storage.sql` is the third file, and it exists because `schema.sql` covers `public` only
(#401).** Two things the attachments feature added were in no backup at all: the `storage.buckets`
row for `attachments` — its `public = false`, size limit, and MIME allow-list — and its
`storage.objects` policies, which are the entire object-side authorization boundary. A restore
without them rebuilt `task_attachments` rows pointing at a bucket that either did not exist or
existed with no policies, and **nothing failed** — the worst shape, because the feature is simply
unprotected or broken rather than loudly absent.

`scripts/dump-storage-metadata.mjs` reads both from production through the Management API and emits
idempotent SQL: `insert ... on conflict do update` for the bucket, and `drop policy if exists` +
`create policy` for each policy. Read from production rather than trusted from
`20260918210000_task_attachments_foundation.sql`, which creates all of it — migrations do replay on
a rebuilt project, so in practice it would come back, but that is an assumption and #384 is what
this repository learned about assuming production matches its migrations.

Widening the existing dumps to `storage` would have been wrong twice, which is why this is a
separate generator rather than a flag: the schema half would capture platform-managed tables a
Supabase project provisions itself, and the data half would capture every `storage.objects` row —
metadata for files whose bytes are in no backup, so a restore would rebuild rows pointing at
objects that do not exist. That is the silent-breakage shape, not a fix for it.

The verify step asserts the bucket line is present, that the membership-scoped SELECT and DELETE
policies are present, that no direct attachment INSERT/UPDATE policy is restored, and **that the
bucket is restored as private** — a bucket restored with `public = true` makes every
object policy decorative, because the object URL alone serves the file, and it restores perfectly
cleanly. The generator itself refuses to write a file with no bucket row or no policies, so
"attachments are backed up" cannot be recorded for a bundle that restores nothing.

**The object BYTES remain in no backup of any kind, deliberately (#401).** A restore brings back
the bucket, its configuration, its policies, and the `task_attachments` rows — and every attached
file is gone. That decision is deferred rather than settled: backing up bytes is unbounded in size,
costs egress on the free tier, and **every artifact this repository uploads must be treated as
public**, so it would have to keep the encrypt-on-runner shape. Until it is taken, the honest
statement is the one in the runbook: attachments do not survive a restore.

It also asserts the three Board tables are in `data.sql` and that `schema.sql` defines
`handle_new_user`, `handle_account_deletion`, `create_board`,
`enforce_task_completion_lifecycle`, and `stamp_task_attribution` — `create_board` replaced
`tasks_infer_board_id` in that list when Board creation dropped it (a dump assertion naming a
function that no longer exists fails every night), and the two `tasks` triggers joined it for #241
and #291 respectively, once each existed to lose. These additions guard two shapes of the same
failure: a bundle that verifies clean and restores into a broken database. Without the Board
tables, every restored task carries a `board_id` pointing at nothing — and because `data.sql` sets
`session_replication_role = replica` on its own first line, the foreign key does not stop it, so the
restore _succeeds_ into a database where no task belongs to any reachable board. Without
`handle_new_user`/`handle_account_deletion`/`create_board`, the restored schema has policies and
constraints whose account/board lifecycle triggers are missing, which shows up first as `Database
error deleting user`. Without the two `tasks` triggers the failure is quieter: the CHECK constraints
they normalize ahead of are still there, so a write a live database accepts starts being refused
outright, and attribution silently stops being stamped at all. The function check matters most because
`supabase db dump` takes **no `--schema` flag** here, so what it captures is a vendor default this
repo does not control. `has_function()` normalises quotes the same way `has_table()` already did,
learned the hard way: the v1.2.76 version matched raw `pg_dump`'s unquoted `FUNCTION public.$fn`,
but the workflow runs `supabase db dump`, which quotes every identifier
(`"public"."handle_new_user"`) — so the check could never match and would have failed every nightly
run, caught only by a dump-side rehearsal (`docs/runbooks/restore-from-backup.md`) before it ran
for real. Since the authorization cutover, the verify step also asserts `schema.sql` defines at
least 12 policies (`grep -c '^CREATE POLICY'`) — a dump that captured tables and functions but no
policies would restore into a database that is default-deny on every table, which fails closed but
silently, indistinguishable at a glance from every user losing their data.

Because this repository is public and **GitHub artifacts on public repos are downloadable by
anyone**, the bundle is GPG-symmetric-encrypted on the runner before upload; the plaintext never
leaves the job. Never add a step that uploads anything unencrypted, and never echo dump contents to
the log — the verify step prints table names only, matched at line start and identifier-filtered,
because `COPY` payload rows are user data.

Restoring is not just "load the file": `on_auth_user_created` seeds a conflicting `user_settings`
row, so data loads under `session_replication_role = replica` — which `data.sql` already sets on its
own line 1. Three findings from the first real rehearsal (2026-07-27) that contradict what `AGENTS.md`
used to say: the `tasks.recur_parent_id` self-reference is **not** a restore hazard (the CLI emits one
multi-row `INSERT` per table, so FK checks defer to end of statement — verified at 5,064 rows);
`schema.sql` **cannot** carry `on_auth_user_created`, because that trigger sits on `auth.users` and
the dump is `public`-only, so restoring from it alone leaves new signups with no settings row; and the
direct `db.<ref>.supabase.co` host is IPv6-only, so a restore needs the Session pooler. Full
procedure, including what to verify: `docs/runbooks/restore-from-backup.md`.
