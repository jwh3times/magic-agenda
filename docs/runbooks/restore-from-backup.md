# Runbook: restore the database from a backup

**Read this before you need it.** The first time you follow these steps should not be during an
outage.

- **Produced by:** [`.github/workflows/backup.yml`](../../.github/workflows/backup.yml) — nightly at
  09:00 UTC, plus manual runs (Actions → Backup → Run workflow).
- **Where backups live:** GitHub Actions artifacts on the `Backup` workflow runs, named
  `supabase-backup-YYYY-MM-DD`, **retained 90 days**. Older than that, they are gone.
- **What you need:** the `BACKUP_GPG_PASSPHRASE` value (password manager — it is write-only in
  GitHub, so it cannot be read back out of the repository settings), the Supabase database password,
  and `gpg` plus a `psql` client. Neither tool is as available as it looks:
  - On Windows `gpg` ships with Git for Windows at `C:\Program Files\Git\usr\bin\gpg.exe`. It is on
    Git Bash's `PATH` but **not** PowerShell's, where `gpg` reads as an unknown command. Call it by
    full path (`& "C:\Program Files\Git\usr\bin\gpg.exe" …`) or run that step from Git Bash.
  - `psql` does **not** need to be installed. Every `psql` command below also runs as
    `docker run --rm -v "<dump-dir>:/dump" postgres:17 psql …`, which is how this runbook was last
    rehearsed. Match the image's major version to the server's, or go newer.

## What is in the bundle

| File         | Contents                                                                                                                                       | Why it matters                                                                                                                                          |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schema.sql` | DDL for the `public` schema **only**                                                                                                           | Nearly a substitute for `supabase/migrations/` — but it omits `on_auth_user_created` and `on_auth_user_deleted`, both triggers on `auth.users`. See 3.1 |
| `data.sql`   | **All** rows — `public` (`tasks`, `user_settings`, `boards`, `board_memberships`, `account_profiles`) **and** `auth` (`auth.users`, sessions…) | Everything. This single file carries the accounts and the boards they own                                                                               |

`data.sql` holds the `auth` rows as well as the `public` ones — `supabase db dump --data-only`
includes Supabase-managed schemas even though the schema dump excludes them. There is one data file
and you load it once.

> **Bundles from v1.2.25–v1.2.26 also contain `auth.sql`.** It is a strict subset of `data.sql`.
> **Ignore it** — loading both inserts `auth.users` twice and fails on a duplicate key.

### Why the data load runs with triggers disabled

**`data.sql` already does this itself.** Its first line is `SET session_replication_role = replica;`
and its last is `RESET ALL;` — the Supabase CLI emits both. You cannot forget the setting, and the
`-c "SET session_replication_role = replica;"` in step 3.2 is therefore **redundant**. It is kept
only because it makes the requirement visible at the call site and costs nothing. What matters is
that you never _strip_ line 1.

**What it is actually for: the `on_auth_user_created` trigger.** Inserting into `auth.users` fires
`handle_new_user()` (`init.sql:95`), which creates a **default** `public.user_settings` row for that
user. `data.sql` inserts `auth.users` well before `public.user_settings`, so the dump then tries to
insert the user's _real_ settings row with the same primary key and fails on a duplicate. The
trigger's own `on conflict do nothing` does not help — it guards the trigger's insert, not the
restore's. Reproduced in the 2026-07-27 rehearsal: trigger present, replica mode off, and the load
dies with `duplicate key value violates unique constraint "user_settings_pkey"`. This only bites
when the target _has_ the trigger, which is a live question — see step 3.1.

Since v1.2.76 the same trigger seeds two more rows the same way (`account_profiles`, guarded by its
own `on conflict do nothing`) plus two it cannot guard at all (`boards`, `board_memberships`,
guarded only by "does a current membership already exist", which is false the instant `auth.users`
lands and `board_memberships` hasn't been restored yet). Reasoned from the migrations, not
independently reproduced: `account_profiles` fails the same way `user_settings` does — a duplicate
`account_id` primary key once `data.sql` reaches its own insert. `boards` and `board_memberships` do
**not** fail — the trigger mints a fresh random board id, so there is nothing for the dump's own
board row to collide with — which is worse, not better: it leaves the account owning a second,
empty, phantom board with its own current membership, and no constraint in the schema catches it,
because the unique index is scoped to `(board_id, account_id)`, not to "one current board per
account". This is exactly the failure mode `session_replication_role = replica` on line 1 exists to
prevent; it is one more reason never to strip that line, not a new step to take.

**The circular foreign key on `tasks` is not a hazard here, despite the warning.** `pg_dump` warns
on every run:

```
pg_dump: warning: there are circular foreign-key constraints on this table:
pg_dump: detail: tasks
pg_dump: hint: You might not be able to restore the dump without using --disable-triggers …
```

That is `recur_parent_id` referencing `tasks(id)` — a recurring series is a hidden template row plus
instance rows pointing back at it (`init.sql:42`). The warning is generic advice aimed at
`COPY`-style dumps, and it does not apply to this bundle: the CLI emits **one multi-row `INSERT` per
table**, and foreign keys are `AFTER … FOR EACH ROW` triggers queued to _end of statement_, so every
row is present before any check runs. Row order inside the statement is irrelevant. Verified in the
2026-07-27 rehearsal by forcing the worst case — a template on the statement's final line, 5,064
rows, replica mode off — which restored cleanly.

Do not "fix" the warning by changing what gets dumped. But do not lean on this either if the dump
format ever changes: a switch to `COPY`, or a `--rows-per-insert` cap that splits a table across
statements, would reintroduce exactly the ordering problem the warning describes.

**The `auth.users → boards → board_memberships → tasks` dependency chain is not an ordering hazard
either, for the same reason.** `session_replication_role = replica` disables every FK trigger for
the duration of the load, so it does not matter whether `data.sql` happens to emit `boards` before
`board_memberships` before `tasks` — untested here, since the CLI is not asked to justify its
statement order and nothing in this repo pins it. What replica mode does _not_ disable is `CHECK`
constraints (evaluated directly by the executor, not as a trigger) and unique indexes such as
`board_memberships_current_uniq` — but those need no ordering help either: they were satisfied by
the live database this dump came from, and a dump reproduces rows, not the sequence of writes that
produced them. The one thing that _would_ defeat this is restoring a **partial** `data.sql` (for
example, hand-extracting `public.tasks` rows without their boards) — do not do that; see Step 2 for
when a targeted restore instead of a full one is the right call.

## 1. Get the bundle and open it

```bash
# List recent backup runs, then download the artifact from the one you want.
gh run list --workflow Backup --limit 10
gh run download <run-id> -n supabase-backup-YYYY-MM-DD

gpg --decrypt --output backup.tar.gz supabase-backup-YYYY-MM-DD.tar.gz.gpg
tar -xzf backup.tar.gz          # -> schema.sql, data.sql (v1.2.25-26 bundles add auth.sql; ignore it)
```

If `gpg` reports a bad passphrase, stop — you have the wrong one, and nothing else in this runbook
will work. There is no recovery path for a lost passphrase.

## 2. Decide what you are actually restoring

Be honest about the failure before touching production. The three cases are different:

- **Some rows were deleted or corrupted, the project is otherwise healthy.** Do _not_ wholesale
  restore. Load the relevant dump into a **scratch project or a local `supabase start`**, extract
  just the affected rows, and apply them to production as targeted SQL. A full restore would revert
  every legitimate change made since the backup.
- **The database is unusable but the project exists.** Restore into a fresh project (below), then
  repoint the app. Restoring over a live database is a second outage on top of the first.
- **The project is gone.** Create a new project, then restore into it.

## 3. Restore into a fresh project

### 3.0 Connect through the Session pooler, not the direct host

The dashboard's **direct** connection string (`db.<ref>.supabase.co`) resolves to an **IPv6-only**
address — Supabase publishes no `A` record for it. On a network without working IPv6 (most home ISPs,
and the maintainer's machine as of 2026-07-27) it fails at the very first command:

```
psql: error: could not translate host name "db.<ref>.supabase.co" to address: Name or service not known
```

Use the **Session pooler** string, which is IPv4-reachable. Note that the username carries the
project ref:

```bash
export PGURI='postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres'
```

Copy the exact host from the dashboard (Project Settings → Database → Connection string → Session
pooler). The region and the `aws-0`/`aws-1` prefix vary per project, and a wrong one fails with
`FATAL: (ENOTFOUND) tenant/user postgres.<ref> not found`.

**It must be the Session pooler on 5432, not the Transaction pooler on 6543.**
`session_replication_role` is a session-level setting and the load runs as a single transaction; the
transaction pooler multiplexes statements across backends and breaks both.

### 3.1 Schema — and the two triggers the bundle cannot carry

**Preferred: apply the migrations.** `supabase db push` builds the schema from
`supabase/migrations/`, which includes both `on_auth_user_created` and `on_auth_user_deleted`, so
the result is correct by construction. It is also the right choice whenever the backup predates the
newest migration.

**Alternative: load `schema.sql`.** Self-contained, but it is a **`public`-schema dump**, and both
triggers live on `auth.users` — so **neither is in the bundle at all**:

```bash
psql "$PGURI" -v ON_ERROR_STOP=1 -f schema.sql
```

On this path you **must** recreate both, or the restore looks perfect and two different things break
quietly. `schema.sql` does carry the functions behind them (`handle_new_user()`,
`handle_account_deletion()`, `create_board()` — all `public`-schema objects, so only the
`auth.users` triggers are missing), so it is just the two `create trigger` statements:

```bash
psql "$PGURI" -v ON_ERROR_STOP=1 -c '
create or replace trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace trigger on_auth_user_deleted
  before delete on auth.users
  for each row execute function public.handle_account_deletion();'
```

Without `on_auth_user_created`, everyone who signs up afterwards gets no `user_settings` row (and,
since v1.2.76, no `account_profiles`/`boards`/`board_memberships` rows either — a broken account with
nowhere to put a task). Without `on_auth_user_deleted`, the very next `delete-account` call fails
outright: `board_memberships.account_id` is `on delete set null` but the table's check constraint
requires a null `account_id` to sit on an already-ended row, so the delete raises
`Database error deleting user` instead of quietly degrading. That failure mode is loud, not silent —
but it is still worth getting right the first time rather than discovering it mid-incident.

`supabase/migrations/20260629120000_init.sql:109` is the source of truth for the first trigger's DDL;
`supabase/migrations/20260813210400_account_deletion.sql` is the source of truth for the second.
Copy from there if either has since changed. Step 4 asserts both triggers exist, because nothing else
surfaces this: the 2026-07-27 rehearsal found the first one missing only by inserting a probe user
and checking whether settings appeared. Order does not matter — `data.sql` runs in replica mode, so
both triggers are inert during the load whether they exist yet or not.

### 3.2 Data

```bash
# All rows — accounts and boards together. data.sql sets replica mode on line 1 and RESETs at the
# end, so the -c below is redundant but harmless. Never strip line 1.
psql "$PGURI" -v ON_ERROR_STOP=1 --single-transaction \
  -c "SET session_replication_role = replica;" \
  -f data.sql
```

`-v ON_ERROR_STOP=1` is not optional: without it `psql` continues past failures and you end up with
a partial restore that looks like it worked. `--single-transaction` means a mid-file failure rolls
back cleanly instead of leaving half the board loaded.

For scale: the 2026-07-27 rehearsal restored 5 accounts and 3 tasks in about 4 seconds end to end. A
slow restore means something is wrong, not that it is working hard.

`SET session_replication_role` needs privilege the Supabase `postgres` role does have — **verified
2026-07-27**, where it reports `usesuper = f` and the `SET` still succeeds. If it is ever refused,
remember the setting also sits on **line 1 of `data.sql`**, so the load aborts inside the file and
`--single-transaction` rolls it back. You would then have to both strip that line _and_ drop
`on_auth_user_created` for the duration, then recreate it — and, since v1.2.76, `on_auth_user_deleted`
too, though that one is far less likely to fire mid-load (nothing in `data.sql` deletes from
`auth.users`). Dropping the trigger(s) alone is sufficient — the foreign-key ordering is a non-issue,
as above — which the rehearsal confirmed for `on_auth_user_created`.

## 4. Verify before declaring victory

```sql
select count(*) from auth.users;
select count(*) from public.tasks;
select count(*) from public.user_settings;
select count(*) from public.boards;
select count(*) from public.board_memberships;
select count(*) from public.account_profiles;
-- No task may reference a user that did not come back:
select count(*) from public.tasks t
  left join auth.users u on u.id = t.user_id
 where u.id is null;   -- must be 0

-- Nor a board that did not come back — the v1.2.76 companion to the check above. board_id is still
-- nullable pre-cutover, so a legitimately-unrouted task is not itself a defect; a task pointing at a
-- board that is simply absent from the restore is:
select count(*) from public.tasks t
  left join public.boards b on b.id = t.board_id
 where t.board_id is not null and b.id is null;   -- must be 0

-- Nor a board without a current owner — the backfill's own gate (20260813210200), re-checked here
-- because a partial restore of board_memberships would violate it silently, not loudly:
select count(*) from public.boards b
 where not exists (
   select 1 from public.board_memberships m
    where m.board_id = b.id and m.role = 'owner' and m.ended_at is null
 );   -- must be 0

-- And no recurring instance may reference a template that did not come back. This is the check
-- that catches a restore done with FK triggers disabled but rows missing — the failure the
-- disabled triggers would otherwise have hidden:
select count(*) from public.tasks t
  left join public.tasks p on p.id = t.recur_parent_id
 where t.recur_parent_id is not null and p.id is null;   -- must be 0

-- Authorization came back. RLS is the ONLY authorization boundary in this app, so a restore that
-- silently lost it is a security incident that every count above would still report as clean:
select bool_and(relrowsecurity) from pg_class
 where relname in ('tasks', 'user_settings', 'boards', 'board_memberships', 'account_profiles');
                                                                 -- must be true
-- 12 at the authorization cutover (2026-08-14 rehearsal log below), +4 from Labels
-- (20260816134515_board_labels.sql), +1 from Board deletion's Owner-only DELETE policy on
-- `boards` (20260818140000_board_deletion.sql):
select count(*) from pg_policies where schemaname = 'public';  -- must be 17

-- The two auth-schema triggers exist. schema.sql cannot carry either (see 3.1), and their absence
-- is invisible until, respectively, a new user signs up and silently gets no settings/board row, or
-- an existing user tries to delete their account and gets "Database error deleting user":
select count(*) from pg_trigger where tgname = 'on_auth_user_created';  -- must be 1
select count(*) from pg_trigger where tgname = 'on_auth_user_deleted';  -- must be 1
```

If any count is wrong, do not put the project back in front of users — the restore is incomplete, and
disabled FK triggers mean the database will not tell you again.

**Read the recurrence check honestly.** It returns `0` both when recurrence restored correctly and
when there is no recurrence data at all. As of 2026-07-27 production holds zero templates and zero
instances, so on today's data that query **cannot fail**. Keep it for the day there is recurrence
data, but do not read a green result as evidence those rows came back.

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

Rehearse in **two passes** — they catch different classes of defect, and the cheap one catches most:

1. **Local `supabase start`**, with `drop schema public cascade; create schema public;` first to
   simulate a fresh project. Free, fast to retry, and it exercises the whole load. But you are
   superuser locally, so it can never test the privilege question in 3.2, and it tells you nothing
   about connectivity.
2. **A throwaway hosted project**, which is the only place 3.0 (IPv6 vs. the pooler) and 3.2
   (`session_replication_role` as a non-superuser) are real. Delete it immediately afterwards — it
   holds every user's email address and password hash.

**Only partly rehearsed against the Board tables.** The 2026-07-27 rehearsal below predates
`account_profiles` / `boards` / `board_memberships`, the `on_auth_user_deleted` trigger, and the
`board_id` orphan/ownership checks added to Step 4 in v1.2.76. A **dump-side** pass on 2026-08-14
verified what the bundle contains (see the log), which upgraded one claim in this file from reasoned
to measured: `schema.sql` really does carry **zero** `auth.users` triggers, so the recreate commands
in 3.1 are load-bearing rather than precautionary.

What is still unverified is the **load** side: no restore of a Board-era bundle into a fresh project
has been run. Replica-mode FK suppression and the CLI's `INSERT`-per-table shape are still reasoned
from the 2026-07-27 pass. Treat the new counts in Step 4 as unconfirmed until a quarterly rehearsal
exercises them — the dump-side pass cannot, because the `public`-only `schema.sql` carries six
foreign keys into `auth.users` and therefore cannot be restored into a bare database at all. It
needs a project that provisions `auth` itself, which is exactly why step 1 says to create one.

### Rehearsal log

- **2026-08-14** — **dump-side only**, at the authorization cutover. Dumped a real local database
  with the same `supabase db dump` the workflow runs, then ran the workflow's own assertions against
  the output. Confirmed the bundle carries all 12 policies, all four `public` functions including
  the three lifecycle ones, the `board_id` NOT NULL, and the composite recurrence foreign key; and
  that it carries **zero** `auth.users` triggers and six foreign keys into `auth.users`.
  **Found one defect, which is the reason this pass was worth running:** the function assertion
  added to `backup.yml` in v1.2.76 was written as `grep "FUNCTION public\.$fn"` and verified against
  raw `pg_dump`, which writes identifiers unquoted. The workflow runs `supabase db dump`, which
  writes `"public"."handle_new_user"` — so the assertion could never match and would have failed the
  entire backup job on its next nightly run, producing no backup. The last successful run was
  2026-08-13 10:02Z, before that change merged, so nothing was lost. Fixed by normalising quotes the
  way the existing table check already did, two lines above it. No restore was performed: the
  `public`-only dump cannot load into a bare database.
- **2026-07-27** — first full rehearsal, against backup run `30265510548`. Restored twice, locally
  and into a throwaway hosted project via the Session pooler. Both reached counts matching production
  (5 accounts, 3 tasks, 5 settings rows) with both orphan checks at 0, RLS on, and 7 policies present;
  the whole restore took ~4 seconds. The passphrase held in the password manager decrypted the bundle,
  which had never been confirmed outside CI. Six defects in this runbook were found and fixed in the
  same change: the IPv6-only direct host, the missing `on_auth_user_created` trigger, the absent
  RLS/policy/trigger verification, the mis-stated circular-FK hazard, the unexplained redundant `SET`,
  and the incomplete privilege fallback. Every one of them was found by running the file, not reading
  it.
