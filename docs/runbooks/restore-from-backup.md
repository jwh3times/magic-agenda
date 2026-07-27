# Runbook: restore the database from a backup

**Read this before you need it.** The first time you follow these steps should not be during an
outage.

- **Produced by:** [`.github/workflows/backup.yml`](../../.github/workflows/backup.yml) — nightly at
  09:00 UTC, plus manual runs (Actions → Backup → Run workflow).
- **Where backups live:** GitHub Actions artifacts on the `Backup` workflow runs, named
  `supabase-backup-YYYY-MM-DD`, **retained 90 days**. Older than that, they are gone.
- **What you need:** the `BACKUP_GPG_PASSPHRASE` value (password manager — it is write-only in
  GitHub, so it cannot be read back out of the repository settings), the Supabase database password,
  and `psql` plus `gpg` locally.

## What is in the bundle

| File         | Contents                                                                                  | Why it matters                                                              |
| ------------ | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `schema.sql` | DDL for the `public` schema                                                                | Redundant with `supabase/migrations/`, but makes the bundle self-contained   |
| `data.sql`   | **All** rows — `public` (`tasks`, `user_settings`) **and** `auth` (`auth.users`, sessions…) | Everything. This single file carries both the accounts and their boards      |

`data.sql` holds the `auth` rows as well as the `public` ones — `supabase db dump --data-only`
includes Supabase-managed schemas even though the schema dump excludes them. There is one data file
and you load it once.

> **Bundles from v1.2.25–v1.2.26 also contain `auth.sql`.** It is a strict subset of `data.sql`.
> **Ignore it** — loading both inserts `auth.users` twice and fails on a duplicate key.

### Two reasons the data load needs triggers disabled

Both are handled by the `session_replication_role = replica` in the command below. Neither is
optional, and neither announces itself until the load is already failing.

**1. The circular foreign key on `tasks`.**

`tasks.recur_parent_id` references `tasks(id)` — a recurring series is a hidden template row plus
instance rows pointing back at it (`init.sql:42`). That makes `tasks` self-referential, and `pg_dump`
says so on every run:

```
pg_dump: warning: there are circular foreign-key constraints on this table:
pg_dump: detail: tasks
```

This is expected and not a problem with the backup. It is a problem with the **restore**: a
`--data-only` load inserts rows in dump order, so an instance row can arrive before the template it
references and fail with a foreign-key violation. Do not "fix" the warning by changing what gets
dumped.

**2. The `on_auth_user_created` trigger seeds rows that then collide.** Inserting into `auth.users`
fires `handle_new_user()` (`init.sql:95`), which creates a **default** `public.user_settings` row for
that user. The dump then tries to `COPY` the user's *real* settings row with the same primary key and
fails on a duplicate. The trigger's own `on conflict do nothing` does not help — it guards the
trigger's insert, not the restore's. Whether this bites at all depends on the order tables appear in
the dump, which is exactly the kind of thing that works in rehearsal and fails in production.

## 1. Get the bundle and open it

```bash
# List recent backup runs, then download the artifact from the one you want.
gh run list --workflow Backup --limit 10
gh run download <run-id> -n supabase-backup-YYYY-MM-DD

gpg --decrypt --output backup.tar.gz supabase-backup-YYYY-MM-DD.tar.gz.gpg
tar -xzf backup.tar.gz          # -> schema.sql, data.sql, auth.sql
```

If `gpg` reports a bad passphrase, stop — you have the wrong one, and nothing else in this runbook
will work. There is no recovery path for a lost passphrase.

## 2. Decide what you are actually restoring

Be honest about the failure before touching production. The three cases are different:

- **Some rows were deleted or corrupted, the project is otherwise healthy.** Do *not* wholesale
  restore. Load the relevant dump into a **scratch project or a local `supabase start`**, extract
  just the affected rows, and apply them to production as targeted SQL. A full restore would revert
  every legitimate change made since the backup.
- **The database is unusable but the project exists.** Restore into a fresh project (below), then
  repoint the app. Restoring over a live database is a second outage on top of the first.
- **The project is gone.** Create a new project, then restore into it.

## 3. Restore into a fresh project

```bash
# Get the connection string from the Supabase dashboard: Project Settings -> Database.
export PGURI='postgresql://postgres:<password>@db.<ref>.supabase.co:5432/postgres'

# 1. Schema. Skip this if you would rather apply supabase/migrations/ with `supabase db push`,
#    which is the better choice when the backup is older than the newest migration.
psql "$PGURI" -v ON_ERROR_STOP=1 -f schema.sql

# 2. All data — accounts and boards together — with triggers off for the session, for both
#    reasons above. The SET and the -f must be ONE psql invocation: session_replication_role
#    does not survive across separate connections.
psql "$PGURI" -v ON_ERROR_STOP=1 --single-transaction \
  -c "SET session_replication_role = replica;" \
  -f data.sql
```

`-v ON_ERROR_STOP=1` is not optional: without it `psql` continues past failures and you end up with
a partial restore that looks like it worked. `--single-transaction` means a mid-file failure rolls
back cleanly instead of leaving half the board loaded.

If `SET session_replication_role` is refused (it needs sufficient privilege — the `postgres` role on
Supabase has it), do **not** just retry the load: drop the `on_auth_user_created` trigger, load, then
recreate it from `schema.sql`. Retrying resolves the foreign-key ordering but not the settings-row
collision.

## 4. Verify before declaring victory

```sql
select count(*) from auth.users;
select count(*) from public.tasks;
select count(*) from public.user_settings;
-- No task may reference a user that did not come back:
select count(*) from public.tasks t
  left join auth.users u on u.id = t.user_id
 where u.id is null;   -- must be 0

-- And no recurring instance may reference a template that did not come back. This is the check
-- that catches a restore done with FK triggers disabled but rows missing — the failure the
-- disabled triggers would otherwise have hidden:
select count(*) from public.tasks t
  left join public.tasks p on p.id = t.recur_parent_id
 where t.recur_parent_id is not null and p.id is null;   -- must be 0
```

If either count is non-zero, do not put the project back in front of users — the restore is
incomplete, and disabled FK triggers mean the database will not tell you again.

Then sign in as a real user and confirm a board renders, a task saves, and realtime still syncs.

## 5. If it is a new project, repoint the app

The project ref changes, so:

1. Update `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in the Cloudflare Pages project
   (Production **and** Preview) — these are inlined at build time, so a redeploy is required.
2. Update the `SUPABASE_PROJECT_ID`, `SUPABASE_DB_PASSWORD`, and `SUPABASE_ACCESS_TOKEN` repository
   secrets.
3. Re-apply auth configuration: merge any change touching `supabase/config.toml` (or run the
   **Deploy Auth Config** workflow manually) so the redirect allow-list, password policy, SMTP, and
   the email templates land on the new project. A restored database does **not** carry these.
4. Recreate the Google OAuth client's redirect URI for the new `<ref>.supabase.co` host.

## Rehearse it

Restores that have never been run do not work. Once a quarter, or after any change to the backup
workflow: create a throwaway Supabase project, run steps 1–4 against it, confirm the counts, and
delete it. It costs twenty minutes and it is the only thing that turns this file from a hope into a
procedure.
