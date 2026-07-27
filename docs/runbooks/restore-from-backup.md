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

| File         | Contents                                            | Why it matters                                                                  |
| ------------ | --------------------------------------------------- | ------------------------------------------------------------------------------- |
| `schema.sql` | DDL for the `public` schema                          | Redundant with `supabase/migrations/`, but makes the bundle self-contained       |
| `data.sql`   | Rows in `public` (`tasks`, `user_settings`)          | The boards themselves                                                            |
| `auth.sql`   | Rows in `auth` (`auth.users` and friends)            | **Restore this first** — every task's `user_id` is a foreign key into `auth.users` |

Order matters: loading `data.sql` before `auth.sql` fails on foreign keys, or silently orphans rows
if constraints are deferred.

### The circular foreign key on `tasks`

`tasks.recur_parent_id` references `tasks(id)` — a recurring series is a hidden template row plus
instance rows pointing back at it (`init.sql:42`). That makes `tasks` self-referential, and `pg_dump`
says so on every run:

```
pg_dump: warning: there are circular foreign-key constraints on this table:
pg_dump: detail: tasks
```

This is expected and not a problem with the backup. It is a problem with the **restore**: a
`--data-only` load inserts rows in dump order, so an instance row can arrive before the template it
references and fail with a foreign-key violation. The load below therefore disables FK triggers for
the session. Do not skip that — and do not "fix" the warning by changing what gets dumped.

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

# 2. Accounts BEFORE board data — see the table above.
psql "$PGURI" -v ON_ERROR_STOP=1 -f auth.sql

# 3. Board data, with foreign-key triggers off for the session so the self-referencing
#    tasks.recur_parent_id cannot fail on row order. Both commands must run in ONE psql session —
#    session_replication_role does not survive across invocations.
psql "$PGURI" -v ON_ERROR_STOP=1 --single-transaction \
  -c "SET session_replication_role = replica;" \
  -f data.sql
```

`-v ON_ERROR_STOP=1` is not optional: without it `psql` continues past failures and you end up with
a partial restore that looks like it worked. `--single-transaction` means a mid-file failure rolls
back cleanly instead of leaving half the board loaded.

If `SET session_replication_role` is refused (it needs sufficient privilege — the `postgres` role on
Supabase has it), the fallback is to load `data.sql` as-is and re-run it: the first pass inserts the
template rows it can, the second resolves the references that failed. Verify counts either way.

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
