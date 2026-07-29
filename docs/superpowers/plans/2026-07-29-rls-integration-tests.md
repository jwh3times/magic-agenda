# RLS Integration Tests — Implementation Plan (Part 1 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the project's only authorization boundary — Postgres Row-Level Security — automated test coverage, running against a real local Supabase stack.

**Architecture:** A second Vitest project (`vitest.rls.config.ts`) runs integration tests in `tests/rls/` against a stack started by `supabase start`. It is deliberately separate from the default project, which is hermetic by design. Tests drive the database through two real `supabase-js` clients (one per test user) exactly as a browser would, plus one direct `pg` connection for `pg_catalog` structural checks that PostgREST cannot reach.

**Tech Stack:** Vitest 4, `@supabase/supabase-js` (already a dependency), `pg` (new devDependency), the Supabase CLI, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-07-28-test-coverage-rls-and-e2e-design.md` — Part 1 only. Part 2 (Playwright) is a separate plan and depends on nothing here.

## Global Constraints

- **Branch:** work on `test/coverage-rls-and-e2e` (already created off `main`, and already holds the spec commits). `main` is PR-only; never push to it directly.
- **Target release version: `1.2.38`** — confirmed via `node scripts/next-version.mjs`. `CHANGELOG.md` must gain a `## [1.2.38]` section or the required `Changelog` CI job fails.
- **`npm test` must stay hermetic.** It is the fast unit suite and must never require Docker, a database, or a network. If `npm test` starts needing a running stack, the change is wrong.
- **RLS is the only authorization boundary.** Nothing in this plan may weaken a policy to make a test pass. If a test fails, the test or the grant is wrong — never the policy.
- **Never put a production key in this work.** These tests run only against `127.0.0.1`. No production URL, anon key, or service-role key appears anywhere in this plan.
- **Never pass the real `RESEND_API_KEY` to a job running `supabase start`.** `supabase/config.toml` enables SMTP against `smtp.resend.com`, so a local GoTrue holding the production key could send real email from a test run. Use explicit dummy values.
- **`noUnusedLocals` / `noUnusedParameters` are ON.**
- Verification commands: `npm test`, `npm run test:rls`, `npm run lint`, `npm run format:check`, `npx tsc -b`.

---

## File Structure

**Created**

| File                                                              | Responsibility                                                                        |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `supabase/migrations/20260729100000_explicit_data_api_grants.sql` | Makes the Data API role grants explicit (see Task 1 — not a test file).               |
| `vitest.rls.config.ts`                                            | The second Vitest project: node env, serial, `tests/rls/` only.                       |
| `tsconfig.test.json`                                              | Typechecks `tests/` — otherwise it is the only untypechecked TS in the repo.          |
| `tests/rls/globalSetup.ts`                                        | Reads the running stack's URLs and keys into `process.env`; fails loudly if no stack. |
| `tests/rls/helpers.ts`                                            | Client factories, test-user lifecycle, `pg` connection.                               |
| `tests/rls/grants.test.ts`                                        | The canary: proves the Data API grants work at all.                                   |
| `tests/rls/reloptions.ts`                                         | Pure `isSecurityInvoker` predicate, split out so it can be tested directly.           |
| `tests/rls/reloptions.test.ts`                                    | Direct tests for that predicate — the definer-view check runs over an empty set.      |
| `tests/rls/structure.test.ts`                                     | Schema-wide catch-alls (RLS enabled, policies exist, no definer views, grants).       |
| `tests/rls/policies.test.ts`                                      | Per-policy behavior: isolation, forged owner, ownership transfer, anon.               |

**Modified**

| File                                                      | Change                                                                                        |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `vite.config.ts`                                          | Exclude `tests/rls/**`; change the dummy Supabase URL off the live local port.                |
| `tsconfig.json`                                           | Add a reference to `tsconfig.test.json`.                                                      |
| `tsconfig.node.json`                                      | Add `vitest.rls.config.ts` to `include` — otherwise it is untypechecked.                      |
| `package.json`                                            | `test:rls*` scripts; widened prettier globs; `pg`, `@types/pg`, `@types/node`, `supabase` devDeps. |
| `.github/workflows/ci.yml`                                | New `RLS` job.                                                                                |
| `AGENTS.md` / `README.md` / `ROADMAP.md` / `CHANGELOG.md` | Docs.                                                                                         |

---

### Task 1: Explicit Data API grants migration

This is not test scaffolding — it is a production schema-parity fix that this work exposed.

`supabase/config.toml` leaves `auto_expose_new_tables` unset, which per the CLI's own comment means entities created in `public` are **not** reachable through the Data API roles without explicit `GRANT`s. There are zero `GRANT` statements in the existing eight migrations. Production works only because its tables were created in June under the legacy auto-expose behavior. Replaying the migrations into a fresh database yields `42501 permission denied` on every PostgREST call. The same config field is **removed on 2026-10-30**, after which new production tables would be silently unreachable too.

**Files:**

- Create: `supabase/migrations/20260729100000_explicit_data_api_grants.sql`

**Interfaces:**

- Produces: `anon`, `authenticated`, and `service_role` hold explicit DML grants on `public.tasks` and `public.user_settings`. Every later task depends on this.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260729100000_explicit_data_api_grants.sql`:

```sql
-- Explicit Data API grants.
--
-- `supabase/config.toml` leaves `auto_expose_new_tables` unset, so entities created in `public`
-- are NOT reachable through the Data API roles (anon, authenticated, service_role) without
-- explicit GRANTs -- the new cloud default. No earlier migration grants anything; production
-- works only because its tables were created under the legacy auto-expose behaviour. That
-- compatibility flag is REMOVED on 2026-10-30, so this file is what keeps the Data API working
-- for anything added after that date. It is a no-op against production: a reviewer confirmed
-- production already carries the `pg_default_acl` entries that grant these two tables to
-- anon/authenticated/service_role, so restating the grants here changes nothing there.
--
-- `anon` genuinely needs SELECT here, and RLS -- not the grant -- is what denies it. An
-- unauthenticated select must resolve to zero rows with NO error: `useSettings` branches on
-- exactly that distinction (an error means "fall back to the snapshot", no rows means "no
-- settings row yet"). Revoking anon would turn empty results into 42501 errors and silently
-- change that behaviour. tests/rls/policies.test.ts pins it.
--
-- Deliberately NO `alter default privileges` in this file. That clause would auto-grant every
-- table ever created afterward by the role running migrations, forever -- so "forgot to enable
-- row-level security on a new table" would degrade from a loud `42501` into a silently
-- world-readable table through the public anon key, in a repo whose entire model is that every
-- table default-denies until proven otherwise. Without it, a new table is simply unreachable
-- until it is granted right here, in this file: a loud error a developer hits the moment they
-- touch the Data API, not a leak someone discovers later. The structural test in
-- tests/rls/structure.test.ts ("every table in public is reachable by the Data API roles") is the
-- backstop that catches a table which shipped without its grant.
grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update, delete on public.tasks
  to anon, authenticated, service_role;

grant select, insert, update, delete on public.user_settings
  to anon, authenticated, service_role;

grant usage, select on all sequences in schema public
  to anon, authenticated, service_role;
```

> **Post-execution note:** the two `alter default privileges` statements originally planned here
> were removed in the final fix wave (2026-07-29) at the human reviewer's direction: they made a
> forgotten `enable row level security` on a future table silently world-readable instead of a
> loud `42501`. The migration file, `AGENTS.md`, and `tests/rls/structure.test.ts`'s fourth-test
> comment were all updated to match; see that commit for the full rationale. The SQL block above
> reflects the final, shipped state.

- [ ] **Step 2: Verify it applies to a fresh database**

The `supabase` devDependency is not installed until Task 2, so pin the version **inline** here —
otherwise this first stack is started by whatever `npx` fetches as `latest`, and the pin that
Task 2 establishes would not describe the stack already running:

Run: `npx supabase@2.110.0 start -x studio,edge-runtime,logflare,vector,imgproxy`
Then: `npx supabase@2.110.0 db reset`
Expected: all nine migrations apply with no error, ending with `20260729100000_explicit_data_api_grants`.

The first `supabase start` pulls Docker images and can take several minutes. If it fails complaining about a missing `env()` variable, set dummy values in your shell (`RESEND_API_KEY=dummy`, `GOOGLE_OAUTH_CLIENT_SECRET=dummy`) — **never the real ones**. If it fails on a missing `supabase/seed.sql`, create an empty one and note it in your report.

Behavioral proof that the grants actually work comes in Task 3's canary test. This step only proves the SQL is valid and applies.

- [ ] **Step 3: Do NOT push to production**

Unlike the v1.2.36 migration, this needs no manual `supabase db push`: grants do not change generated types, so `src/types/database.types.ts` does not need regenerating. The `Deploy Migrations` workflow applies it on merge, where it is a no-op.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260729100000_explicit_data_api_grants.sql
git commit -m "feat(db): make Data API role grants explicit"
```

---

### Task 2: RLS Vitest project, and fixing the hermetic boundary

**Files:**

- Create: `vitest.rls.config.ts`, `tsconfig.test.json`
- Modify: `vite.config.ts`, `tsconfig.json`, `package.json`

**Interfaces:**

- Produces: `npm run test:rls` runs only `tests/rls/**`; `npm run test:rls:up` / `test:rls:down` manage the stack; `tests/` is typechecked by `tsc -b`.

- [ ] **Step 1: Add the RLS Vitest project**

Create `vitest.rls.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

// Integration tests against a REAL local Supabase stack (`npm run test:rls:up`).
//
// Deliberately a separate project from vite.config.ts, whose suite is hermetic: that one injects
// dummy Supabase env precisely so a unit test can never reach a live database. These tests are
// the opposite -- they exist to exercise the real one -- so the two must never share a config.
export default defineConfig({
  test: {
    include: ['tests/rls/**/*.test.ts'],
    environment: 'node',
    globals: true,
    globalSetup: ['tests/rls/globalSetup.ts'],
    // One shared database. Parallel files would race on rows, users, and roles.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
})
```

- [ ] **Step 2: Keep the RLS tests out of `npm test`**

In `vite.config.ts`, the `test.exclude` line currently reads:

```ts
    exclude: [...configDefaults.exclude, 'supabase/functions/**'],
```

Replace it with:

```ts
    // Vitest's default `include` matches the whole repo, so without this the RLS integration
    // tests would be swept into `npm test` -- which must never need Docker or a database.
    exclude: [...configDefaults.exclude, 'supabase/functions/**', 'tests/rls/**'],
```

- [ ] **Step 3: Move the hermetic dummy URL off the live local port**

Still in `vite.config.ts`, the `test.env` block currently sets `VITE_SUPABASE_URL: 'http://localhost:54321'` — which is the **real local stack's address** whenever `npm run test:rls:up` is running. Hermeticity rests on mocking alone; an unmocked call would quietly reach a live database instead of failing. Replace the block with:

```ts
    // Hermetic: tests never touch a real project (getSession is local-only anyway).
    // Port 1 is privileged and unbindable, so an unmocked call fails loudly. Do NOT use
    // 54321 here -- that is the local Supabase stack's port and it is live during `test:rls`.
    env: {
      VITE_SUPABASE_URL: 'http://127.0.0.1:1',
      VITE_SUPABASE_ANON_KEY: 'test-anon-key',
    },
```

Leave `src/lib/verifyOtpContract.test.ts:34` alone. Its `http://localhost:54321/auth/v1` is a literal passed to a `GoTrueClient` whose `fetch` is stubbed, so it never opens a socket.

- [ ] **Step 4: Typecheck the tests directory**

Create `tsconfig.test.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "types": ["vitest/globals", "node"],
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noEmit": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "skipLibCheck": true
  },
  "include": ["tests"]
}
```

Do **not** add `"composite": true`. The existing referenced projects (`tsconfig.app.json` and friends) use `noEmit: true` without it, and `tsc -b` is green today — matching that pattern avoids the "composite projects may not disable emit" conflict.

Add it to `tsconfig.json`'s references:

```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.app.json" },
    { "path": "./tsconfig.node.json" },
    { "path": "./tsconfig.worker.json" },
    { "path": "./tsconfig.test.json" }
  ]
}
```

Then close the other hole: `tsconfig.node.json:21` reads `"include": ["vite.config.ts"]`, so the new
`vitest.rls.config.ts` would land in no project at all — recreating, at the repo root, exactly the
untypechecked-TS gap that `tsconfig.test.json` exists to close. It belongs in the node project (same
environment, same `vitest/config` import). Change that line to:

```json
  "include": ["vite.config.ts", "vitest.rls.config.ts"]
```

- [ ] **Step 5: Add scripts and dependencies**

```bash
npm i -D pg @types/pg @types/node supabase@2.110.0
```

All four are required, none conditional:

- `@types/node` is **not** installed today, not even transitively — `tsconfig.test.json` needs it
  both for `"types": [..., "node"]` (TS2688) and for the harness's `node:child_process` /
  `node:crypto` imports.
- `supabase` is pinned **exact** (no `^`) and is what makes the CLI version real rather than
  decorative. `npx supabase` resolves a local binary when one exists and otherwise installs
  `latest` from the registry — so without this devDependency, every `npx supabase` in this plan
  (here, in `globalSetup`, and in CI) would silently float to whatever released most recently,
  which is the exact thing that can rename a `supabase status -o json` key and turn an unrelated
  PR red. Pinning here covers local runs and CI with one mechanism.

In `package.json`, add these three scripts after `"test:watch"`:

```json
    "test:rls": "vitest run --config vitest.rls.config.ts",
    "test:rls:up": "npx supabase start -x studio,edge-runtime,logflare,vector,imgproxy",
    "test:rls:down": "npx supabase stop",
```

`test:rls` deliberately does **not** start a stack. Starting and stopping Docker per test run is slow and surprising; `globalSetup` fails with an actionable message instead.

Leave the `format` / `format:check` globs alone for now — they are widened to cover the new files in
Task 5, once `tests/` actually contains something. Prettier exits non-zero on a glob that matches
nothing, so widening them here would break `format:check` for the next two tasks.

- [ ] **Step 6: Verify the hermetic boundary still holds**

Run: `npm test`
Expected: PASS, and the summary still reports **48 test files / 357 tests** — the same as before. A higher file count means the exclude in Step 2 is not working and the RLS tests are being swept in.

Run: `npx tsc -b`
Expected: **one error, and it is the expected one** —
`error TS18003: No inputs were found in config file 'tsconfig.test.json'`. `include: ["tests"]`
matches nothing until Task 3 creates the first file there, and TypeScript treats an empty project
as an error unconditionally; there is no setting that suppresses it within this task's constraints
(`composite` is forbidden here, and adding a placeholder file to silence a transient error is
worse than the error). Task 3 resolves it by existing.

This does mean this one commit leaves `npm run build` failing. That is accepted: it is an
intermediate commit on a feature branch, CI only builds the PR head, and the very next task fixes
it. **Verify `tsc -b` is clean at the end of Task 3** — if it is not, something beyond TS18003 is
wrong. Confirm the only error here is TS18003 on `tsconfig.test.json`; any other error is a real
failure and must be fixed before committing.

- [ ] **Step 7: Commit**

```bash
git add vitest.rls.config.ts tsconfig.test.json tsconfig.json tsconfig.node.json vite.config.ts package.json package-lock.json
git commit -m "test: add the RLS vitest project and harden the hermetic boundary"
```

---

### Task 3: Test harness and the grants canary

**Files:**

- Create: `tests/rls/globalSetup.ts`, `tests/rls/helpers.ts`, `tests/rls/grants.test.ts`

**Interfaces:**

- Consumes: `vitest.rls.config.ts` (Task 2); the grants from Task 1.
- Produces, from `tests/rls/helpers.ts`:
  - `stack(): { apiUrl: string; dbUrl: string; anonKey: string; serviceKey: string }`
  - `serviceClient(): SupabaseClient`
  - `anonClient(): SupabaseClient`
  - `createTestUser(): Promise<TestUser>` where `TestUser = { id: string; email: string; client: SupabaseClient }`
  - `deleteTestUser(user: TestUser): Promise<void>`
  - `withPg<T>(fn: (c: PgClient) => Promise<T>): Promise<T>`

- [ ] **Step 1: Read the stack's config into the environment**

Create `tests/rls/globalSetup.ts`:

```ts
import { execSync } from 'node:child_process'

/**
 * Reads the running local stack's URLs and keys once, before any test file.
 *
 * These values are generated per machine by `supabase start`, so they cannot be committed.
 * Failing here with an actionable message is much kinder than every test failing on a refused
 * connection.
 */
export default function setup(): void {
  let raw: string
  try {
    // `npx supabase` resolves the exact-pinned devDependency, not a registry `latest` -- see
    // package.json. execSync rather than execFileSync with an args array: it always runs through
    // a shell, which is what makes `npx` work on Windows where it is really `npx.cmd`, and
    // execFileSync given BOTH an args array and shell:true is deprecated (DEP0190) and prints a
    // warning on every single run. The command is a fixed literal -- nothing is interpolated into
    // it, so there is no injection surface.
    raw = execSync('npx supabase status -o json', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (err) {
    // Bind the cause. "No stack running" is only one of the ways this can fail; a wrong CLI
    // version, a spawn failure, or a non-JSON stderr blob all land here too, and reporting those
    // as "none is running" sends a developer to `test:rls:up`, which fixes none of them.
    throw new Error(
      'RLS tests need a local Supabase stack, and `npx supabase status` failed.\n' +
        `Underlying error: ${err instanceof Error ? err.message : String(err)}\n` +
        'If no stack is running, start one with:  npm run test:rls:up\n' +
        'Stop it later with:  npm run test:rls:down',
      // `cause` as well as the interpolated message: eslint's preserve-caught-error requires it,
      // and it keeps the original stack reachable for anyone debugging the failure.
      { cause: err },
    )
  }

  const status = JSON.parse(raw) as Record<string, string>
  const required = ['API_URL', 'DB_URL', 'ANON_KEY', 'SERVICE_ROLE_KEY'] as const
  for (const key of required) {
    if (!status[key]) {
      throw new Error(
        `\`supabase status -o json\` did not report ${key}. ` +
          'Key names have changed across CLI majors -- check the `supabase` version pinned in package.json.',
      )
    }
  }

  process.env.SUPABASE_API_URL = status.API_URL
  process.env.SUPABASE_DB_URL = status.DB_URL
  process.env.SUPABASE_ANON_KEY = status.ANON_KEY
  process.env.SUPABASE_SERVICE_ROLE_KEY = status.SERVICE_ROLE_KEY
}
```

If the first run reports a missing key, print the raw JSON, adjust the four names to match your CLI, and record the change in your report — the exact casing is CLI-version dependent.

- [ ] **Step 2: Write the harness**

Create `tests/rls/helpers.ts`:

```ts
import { randomUUID } from 'node:crypto'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { Client as PgClient } from 'pg'

export interface Stack {
  apiUrl: string
  dbUrl: string
  anonKey: string
  serviceKey: string
}

export function stack(): Stack {
  const { SUPABASE_API_URL, SUPABASE_DB_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY } =
    process.env
  if (!SUPABASE_API_URL || !SUPABASE_DB_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Stack config missing -- globalSetup did not run.')
  }
  return {
    apiUrl: SUPABASE_API_URL,
    dbUrl: SUPABASE_DB_URL,
    anonKey: SUPABASE_ANON_KEY,
    serviceKey: SUPABASE_SERVICE_ROLE_KEY,
  }
}

// No session persistence anywhere: each client is explicit about who it is, and a leaked
// session between tests would make an isolation failure look like a pass.
const NO_SESSION = { auth: { persistSession: false, autoRefreshToken: false } }

/** Bypasses RLS. Only for creating and destroying test users -- never for assertions. */
export function serviceClient(): SupabaseClient {
  const s = stack()
  return createClient(s.apiUrl, s.serviceKey, NO_SESSION)
}

/** A signed-out client, exactly what a visitor to the landing page holds. */
export function anonClient(): SupabaseClient {
  const s = stack()
  return createClient(s.apiUrl, s.anonKey, NO_SESSION)
}

export interface TestUser {
  id: string
  email: string
  client: SupabaseClient
}

/**
 * Creates a confirmed user and returns a client signed in as them.
 *
 * The email is randomised per call so a crashed previous run cannot collide on a stack that is
 * still up. The password satisfies config.toml's `lower_upper_letters_digits_symbols` policy at
 * 10+ characters.
 */
export async function createTestUser(): Promise<TestUser> {
  const s = stack()
  const email = `rls-${randomUUID()}@example.test`
  const password = `Aa1!${randomUUID().replace(/-/g, '').slice(0, 16)}`

  const admin = serviceClient()
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (error) throw new Error(`createTestUser failed: ${error.message}`)
  const id = data.user?.id
  if (!id) throw new Error('createTestUser returned no user id')

  const client = createClient(s.apiUrl, s.anonKey, NO_SESSION)
  const { error: signInError } = await client.auth.signInWithPassword({ email, password })
  if (signInError) throw new Error(`test user sign-in failed: ${signInError.message}`)

  return { id, email, client }
}

export async function deleteTestUser(user: TestUser): Promise<void> {
  await user.client.auth.signOut()
  const admin = serviceClient()
  const { error } = await admin.auth.admin.deleteUser(user.id)
  if (error) throw new Error(`deleteTestUser failed: ${error.message}`)
}

/** Direct SQL. PostgREST exposes only `public` and `graphql_public`, so pg_catalog needs this. */
export async function withPg<T>(fn: (client: PgClient) => Promise<T>): Promise<T> {
  const client = new PgClient({ connectionString: stack().dbUrl })
  await client.connect()
  try {
    return await fn(client)
  } finally {
    await client.end()
  }
}
```

- [ ] **Step 3: Write the canary test**

Create `tests/rls/grants.test.ts`:

```ts
import { afterAll, beforeAll, expect, test } from 'vitest'
import { createTestUser, deleteTestUser, type TestUser } from './helpers'

let user: TestUser

beforeAll(async () => {
  user = await createTestUser()
})

afterAll(async () => {
  // Guarded: if beforeAll threw, an unguarded delete throws a TypeError over the real error.
  if (user) await deleteTestUser(user)
})

// The canary. If this fails with 42501 "permission denied", the Data API grants are missing --
// see supabase/migrations/20260729100000_explicit_data_api_grants.sql. That failure would
// otherwise masquerade as a broken policy in every other test in this suite.
test('an authenticated user can insert and read back their own task', async () => {
  const { error: insertError } = await user.client
    .from('tasks')
    .insert({ user_id: user.id, title: 'canary' })
  expect(insertError).toBeNull()

  const { data, error } = await user.client.from('tasks').select('id, title')
  expect(error).toBeNull()
  expect(data).toHaveLength(1)
  expect(data?.[0].title).toBe('canary')
})

test('the signup trigger seeded exactly one settings row', async () => {
  // on_auth_user_created fires on auth.users insert. schema.sql alone cannot restore this
  // trigger (it lives on an auth-schema table), so a restore that loses it would leave every
  // new signup with no settings row -- this is the test that would catch that.
  const { data, error } = await user.client.from('user_settings').select('user_id')
  expect(error).toBeNull()
  expect(data).toHaveLength(1)
  expect(data?.[0].user_id).toBe(user.id)
})
```

- [ ] **Step 4: Run the canary**

Ensure a stack is running (`npm run test:rls:up`), then:

Run: `npm run test:rls`
Expected: PASS, 2 tests.

If the insert fails with `42501`, Task 1's migration did not apply — run `npx supabase db reset` and retry. **Do not "fix" this by weakening a policy.**

- [ ] **Step 5: Commit**

```bash
git add tests/rls/globalSetup.ts tests/rls/helpers.ts tests/rls/grants.test.ts
git commit -m "test(rls): harness plus a Data API grants canary"
```

---

### Task 4: Structural catch-alls

These need no knowledge of any particular table, which is exactly why they are the highest-value tests here: they keep working as the schema grows.

**Files:**

- Create: `tests/rls/structure.test.ts`

**Interfaces:**

- Consumes: `withPg` from `tests/rls/helpers.ts` (Task 3).

- [ ] **Step 1: Write the pinning tests**

These are characterization tests, not red-then-green TDD: they are expected to pass immediately
against the current schema, because their job is to pin behaviour that is already correct so a
_future_ change cannot break it silently. Do not manufacture a failure to satisfy a red-first
habit — Step 3 is where these are proven to have teeth, empirically.

Create `tests/rls/structure.test.ts`:

First create `tests/rls/reloptions.ts`, the one piece of parsing in this file that the database
cannot exercise:

```ts
/**
 * Does a relation's `reloptions` array mark it `security_invoker`?
 *
 * Split into its own module so it can be tested directly. There are no views in `public` today,
 * so the definer-view assertion in structure.test.ts runs over an EMPTY SET -- it would never
 * execute this parsing, which is the one piece of logic standing between a definer view and the
 * Data API the day someone adds one. Same reasoning as `src/sw/policy.ts`: pulling the pure
 * predicate out is what makes the rule testable at all.
 *
 * `reloptions` stores the spelling used at DDL time, so `security_invoker = on` is exactly as
 * safe as `security_invoker=true`. Anything unrecognised is treated as NOT invoker, which fails
 * safe: the view is flagged for a human to look at rather than silently trusted.
 */
const TRUTHY = new Set(['true', 'on', 'yes', '1'])

export function isSecurityInvoker(options: string[] | null): boolean {
  return (options ?? []).some((o) => {
    const [key, value] = o.split('=')
    return key.trim() === 'security_invoker' && TRUTHY.has((value ?? '').trim().toLowerCase())
  })
}
```

Then `tests/rls/reloptions.test.ts`:

```ts
import { expect, test } from 'vitest'
import { isSecurityInvoker } from './reloptions'

// These need no database. They exist because the definer-view assertion in structure.test.ts
// asserts over zero rows today -- without them this parsing would ship completely untested.

test('recognises every boolean spelling Postgres stores', () => {
  for (const opt of [
    'security_invoker=true',
    'security_invoker=on',
    'security_invoker=yes',
    'security_invoker=1',
  ]) {
    expect(isSecurityInvoker([opt])).toBe(true)
  }
})

test('tolerates the spacing of `WITH (security_invoker = on)`', () => {
  expect(isSecurityInvoker(['security_invoker = on'])).toBe(true)
  expect(isSecurityInvoker(['  security_invoker=TRUE  '])).toBe(true)
})

test('finds the option among unrelated reloptions', () => {
  expect(isSecurityInvoker(['check_option=cascaded', 'security_invoker=true'])).toBe(true)
})

test('treats a definer view as not invoker', () => {
  expect(isSecurityInvoker(null)).toBe(false)
  expect(isSecurityInvoker([])).toBe(false)
  expect(isSecurityInvoker(['check_option=local'])).toBe(false)
  expect(isSecurityInvoker(['security_invoker=false'])).toBe(false)
  expect(isSecurityInvoker(['security_invoker=off'])).toBe(false)
})

test('fails safe on an unrecognised spelling', () => {
  // Postgres accepts `t` on input but does not store it. If that ever changes, this returns
  // false -- flagging a SAFE view for review rather than trusting an unsafe one.
  expect(isSecurityInvoker(['security_invoker=t'])).toBe(false)
})
```

Then `tests/rls/structure.test.ts`:

```ts
import { expect, test } from 'vitest'
import { withPg } from './helpers'
import { isSecurityInvoker } from './reloptions'

// RLS is this project's ONLY authorization boundary and the anon key is public by design, so a
// table that reaches the Data API without RLS is a data leak, not a bug. These four tests need
// no knowledge of what any table is for -- they keep holding as the schema grows.

test('every table in public has row-level security enabled', async () => {
  const rows = await withPg(async (pg) => {
    const res = await pg.query<{ relname: string; relrowsecurity: boolean }>(
      `select c.relname, c.relrowsecurity
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relkind in ('r', 'p')
        order by c.relname`,
    )
    return res.rows
  })

  expect(rows.length).toBeGreaterThan(0)
  const unprotected = rows.filter((r) => !r.relrowsecurity).map((r) => r.relname)
  expect(unprotected).toEqual([])
})

test('every RLS-enabled table has at least one policy', async () => {
  // RLS on with zero policies is default-deny: safe, but it breaks the app silently, which is
  // its own kind of outage and much harder to diagnose than a loud permission error.
  const rows = await withPg(async (pg) => {
    const res = await pg.query<{ relname: string; policy_count: string }>(
      `select c.relname, count(p.polname) as policy_count
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
         left join pg_policy p on p.polrelid = c.oid
        where n.nspname = 'public'
          and c.relkind in ('r', 'p')
          and c.relrowsecurity
        group by c.relname
        order by c.relname`,
    )
    return res.rows
  })

  const policyless = rows.filter((r) => Number(r.policy_count) === 0).map((r) => r.relname)
  expect(policyless).toEqual([])
})

test('no security-definer views are exposed in public', async () => {
  // A view runs with its DEFINER's rights unless it is security_invoker, so it walks straight
  // past the relrowsecurity check above and is still reachable through PostgREST. There are no
  // views today; this test exists so that adding one is a deliberate act.
  const rows = await withPg(async (pg) => {
    const res = await pg.query<{ relname: string; options: string[] | null }>(
      `select c.relname, c.reloptions as options
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relkind in ('v', 'm')
        order by c.relname`,
    )
    return res.rows
  })

  // The spelling normalisation lives in reloptions.ts and is tested directly in
  // reloptions.test.ts -- there are no views in `public` today, so this assertion runs over an
  // empty set and cannot exercise that parsing on its own.
  const definerViews = rows.filter((r) => !isSecurityInvoker(r.options)).map((r) => r.relname)
  expect(definerViews).toEqual([])
})

test('every table in public is reachable by the Data API roles', async () => {
  // The companion to the RLS test above, and the only thing here that guards the 2026-10-30
  // cliff. `auto_expose_new_tables` is unset, so a new table with flawless RLS and no GRANT is
  // simply invisible to the app -- a 42501 that looks nothing like a missing grant. Without this
  // test, "the catch-alls keep working as the schema grows" would be true for RLS and false for
  // grants, which is the exact failure the grants migration was written to prevent.
  //
  // The migration grants explicitly per table -- there is no ALTER DEFAULT PRIVILEGES to fall
  // back on (deliberately: see the header comment on that migration). This test is what catches
  // a table that was added without its grant.
  // Both roles, not just `authenticated`. The migration grants them together, so a table that
  // reached only one of them is a mistake -- and checking a single role would let a table that
  // is invisible to signed-out visitors pass a test whose name promises "the Data API roles".
  const rows = await withPg(async (pg) => {
    const res = await pg.query<{ relname: string; anon: boolean; authenticated: boolean }>(
      `select c.relname,
              has_table_privilege('anon', c.oid, 'select') as anon,
              has_table_privilege('authenticated', c.oid, 'select') as authenticated
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relkind in ('r', 'p')
        order by c.relname`,
    )
    return res.rows
  })

  expect(rows.length).toBeGreaterThan(0)
  expect(rows.filter((r) => !r.anon).map((r) => r.relname)).toEqual([])
  expect(rows.filter((r) => !r.authenticated).map((r) => r.relname)).toEqual([])
})
```

- [ ] **Step 2: Run them**

Run: `npm run test:rls`
Expected: PASS, 11 tests total (2 from Task 3, 4 structural here, 5 `reloptions` here).

- [ ] **Step 3: Prove the catch-alls actually catch**

A structural test that cannot fail is worse than none. Verify empirically, in two stages, which
between them exercise three of the four assertions. Abbreviate the psql call first:

```bash
PSQL="docker exec -i supabase_db_magic-agenda psql -U postgres -d postgres -c"
npx supabase db reset
```

Stage 1 — an unprotected table:

```bash
$PSQL "create table public.leaky (id int);"
npm run test:rls
```

Expected: the **RLS-enabled** test FAILS, naming `leaky`. The grants test still passes here, and
that is correct rather than a miss: the migration's `alter default privileges` ran as `postgres`
and so does this `create table`, so `leaky` is granted automatically — which is precisely the
behaviour that clause exists to produce.

> **Post-execution note:** this described the migration as it stood when Task 4 ran. The `alter
> default privileges` clauses were removed in the 2026-07-29 fix wave (see the note on Task 1), so
> re-running Stage 1 against the current migration would now fail **both** the RLS-enabled test
> and the Data API reachability test for `leaky` — there is no default-privileges clause left to
> auto-grant it. That is the intended, fail-closed behaviour; it does not change Stage 2 below.

Stage 2 — protected but ungranted, the post-2026-10-30 failure mode:

```bash
$PSQL "alter table public.leaky enable row level security; revoke all on public.leaky from anon, authenticated, service_role;"
npm run test:rls
```

Expected: the **RLS-enabled** test now passes, while the **has-a-policy** and **Data API
reachable** tests both FAIL, naming `leaky`.

Clean up and confirm green again:

```bash
$PSQL "drop table public.leaky;"
npm run test:rls
```

If the container name differs, find it with `docker ps --format '{{.Names}}' | grep supabase_db`. Record both stages' outcomes in your report — this step is the evidence the tests have teeth.

- [ ] **Step 4: Commit**

```bash
git add tests/rls/structure.test.ts tests/rls/reloptions.ts tests/rls/reloptions.test.ts
git commit -m "test(rls): schema-wide RLS, policy, and view catch-alls"
```

---

### Task 5: Policy behavior tests

**Files:**

- Create: `tests/rls/policies.test.ts`

**Interfaces:**

- Consumes: `createTestUser`, `deleteTestUser`, `anonClient`, `TestUser` from `tests/rls/helpers.ts` (Task 3).

- [ ] **Step 1: Write the pinning tests**

As in Task 4, these characterize a schema that is already correct and are expected to pass on the
first run — the current policies really do carry the `with check` clauses these assert. Do not
manufacture a red state. Step 2 says what to do if one genuinely fails.

Create `tests/rls/policies.test.ts`:

```ts
import { afterAll, beforeAll, expect, test } from 'vitest'
import { anonClient, createTestUser, deleteTestUser, type TestUser } from './helpers'

let alice: TestUser
let bob: TestUser
let aliceTaskId: string

beforeAll(async () => {
  alice = await createTestUser()
  bob = await createTestUser()

  const { data, error } = await alice.client
    .from('tasks')
    .insert({ user_id: alice.id, title: "alice's task" })
    .select('id')
    .single()
  if (error) throw new Error(`fixture insert failed: ${error.message}`)
  aliceTaskId = data.id as string
})

afterAll(async () => {
  // Guarded: if bob's creation throws, an unguarded delete throws a TypeError over the real
  // error AND leaks alice onto a stack that outlives the run.
  for (const user of [alice, bob]) {
    if (user) await deleteTestUser(user)
  }
})

test("bob cannot see alice's task", async () => {
  // RLS filters rather than errors: the row is invisible, not forbidden.
  const { data, error } = await bob.client.from('tasks').select('id')
  expect(error).toBeNull()
  expect(data).toEqual([])
})

test("bob cannot update alice's task", async () => {
  const { data, error } = await bob.client
    .from('tasks')
    .update({ title: 'hijacked' })
    .eq('id', aliceTaskId)
    .select('id')
  expect(error).toBeNull()
  expect(data).toEqual([]) // matched nothing

  const { data: after } = await alice.client
    .from('tasks')
    .select('title')
    .eq('id', aliceTaskId)
    .single()
  expect(after?.title).toBe("alice's task")
})

test("bob cannot delete alice's task", async () => {
  const { error } = await bob.client.from('tasks').delete().eq('id', aliceTaskId)
  expect(error).toBeNull()

  const { data: after } = await alice.client.from('tasks').select('id').eq('id', aliceTaskId)
  expect(after).toHaveLength(1)
})

test('bob cannot insert a task owned by alice', async () => {
  // The sharp one. A policy with USING but no WITH CHECK passes every test above and still
  // lets one user write rows owned by another.
  const { error } = await bob.client.from('tasks').insert({ user_id: alice.id, title: 'forged' })
  expect(error).not.toBeNull()
  expect(error?.code).toBe('42501')
})

test('alice cannot transfer her task to bob', async () => {
  // The mirror of the above, on the UPDATE policy's WITH CHECK.
  const { error } = await alice.client
    .from('tasks')
    .update({ user_id: bob.id })
    .eq('id', aliceTaskId)
  expect(error).not.toBeNull()
  expect(error?.code).toBe('42501')
})

test("bob cannot read alice's settings row", async () => {
  const { data, error } = await bob.client.from('user_settings').select('user_id')
  expect(error).toBeNull()
  expect(data).toHaveLength(1)
  expect(data?.[0].user_id).toBe(bob.id)
})

test('nobody can delete a settings row -- there is no delete policy', async () => {
  const { error } = await alice.client.from('user_settings').delete().eq('user_id', alice.id)
  expect(error).toBeNull() // default-deny filters rather than errors

  const { data } = await alice.client.from('user_settings').select('user_id')
  expect(data).toHaveLength(1)
})

test('an anonymous client reads zero rows WITHOUT an error', async () => {
  // Load-bearing, not pedantry. AGENTS.md documents this exact behaviour and `useSettings`
  // branches on it: an error means "fall back to the offline snapshot", zero rows means "this
  // user has no settings row yet, seed DEFAULTS". If a grants change turned this into a 42501,
  // a signed-out visitor would silently take the wrong branch.
  const anon = anonClient()

  const tasks = await anon.from('tasks').select('id')
  expect(tasks.error).toBeNull()
  expect(tasks.data).toEqual([])

  const settings = await anon.from('user_settings').select('user_id')
  expect(settings.error).toBeNull()
  expect(settings.data).toEqual([])
})

test('an anonymous client cannot write', async () => {
  const { error } = await anonClient()
    .from('tasks')
    .insert({ user_id: alice.id, title: 'from nowhere' })
  expect(error).not.toBeNull()
})
```

- [ ] **Step 2: Run them**

Run: `npm run test:rls`
Expected: PASS, 20 tests total.

If either the forged-insert or the transfer test fails by getting `error === null`, **the policy is wrong, not the test** — stop and report it. Both are expected to pass against the current schema: `tasks_insert_own` and `tasks_update_own` both carry `with check (auth.uid() = user_id)` in `supabase/migrations/20260629120000_init.sql:59-62`.

- [ ] **Step 3: Bring the new files under Prettier**

Now that `tests/` has files, widen the `format` / `format:check` globs in `package.json` (they are
`src`-only today, which would leave these the only unformatted TS in the repo). Widen **only to
the new paths** — every file they match is authored by this plan, so this cannot turn the required
`Format` job red on a pre-existing file. In particular they must not start matching
`vite.config.ts`, which has never been format-checked:

```json
    "format": "prettier --write \"src/**/*.{ts,tsx,css}\" \"tests/**/*.ts\" vitest.rls.config.ts",
    "format:check": "prettier --check \"src/**/*.{ts,tsx,css}\" \"tests/**/*.ts\" vitest.rls.config.ts",
```

Then run `npm run format` and `npm run format:check`. Expected: clean.

- [ ] **Step 4: Commit**

```bash
# `tests` rather than the one file: `npm run format` above may have reformatted the harness and
# the earlier test files, which were written before Prettier covered them.
git add tests package.json
git commit -m "test(rls): cross-user isolation, forged ownership, and anon behaviour"
```

---

### Task 6: CI job

**Files:**

- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Add the job**

Append to the `jobs:` map in `.github/workflows/ci.yml`, following the existing jobs' shape (`actions/checkout@v7`, `actions/setup-node@v7` with `node-version-file: .nvmrc` and `cache: npm`).

**Indentation matters:** job keys sit at two spaces under `jobs:` (see `ci.yml:18`, `:30`). The
block below is already indented for a direct paste — do not dedent it, or `RLS` becomes a
top-level key and the workflow silently stops defining the job.

```yaml
  RLS:
    runs-on: ubuntu-latest
    # A wedged image pull would otherwise hold a runner for the 360-minute default.
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version-file: .nvmrc
          cache: npm
      # This installs the pinned CLI too. Deliberately NO `supabase/setup-cli` step here, unlike
      # the Config job: every Supabase call in this job and in tests/rls/globalSetup.ts goes
      # through `npx supabase`, and `npx` prefers a local binary but silently installs `latest`
      # from the registry when there is none -- so a setup-cli pin would be ignored and the
      # version would float. `supabase` is an exact-pinned devDependency instead, which pins CI
      # and local runs with one mechanism. If you add setup-cli back, change these to bare
      # `supabase` or the pin does nothing.
      - run: npm ci
      - name: Start a local stack
        # Only the database, auth, and PostgREST are needed; skipping the rest cuts minutes off
        # a cold runner. Every value below is a DUMMY: config.toml references these via env().
        # RESEND_API_KEY and GOOGLE_OAUTH_CLIENT_SECRET are the load-bearing two -- never pass
        # the real RESEND_API_KEY, since config.toml enables SMTP against smtp.resend.com and a
        # local GoTrue holding the real key could send real email from a test run. The rest are
        # cheap insurance: the Config job passes today with only those two set, so the CLI does
        # tolerate unresolved env() at parse time, but this job actually STARTS storage
        # (config.toml:147-149) rather than only parsing the file.
        run: npx supabase start -x studio,edge-runtime,logflare,vector,imgproxy
        env:
          RESEND_API_KEY: dummy-not-a-real-key
          GOOGLE_OAUTH_CLIENT_SECRET: dummy-not-a-real-secret
          OPENAI_API_KEY: dummy-not-a-real-key
          S3_HOST: dummy.local
          S3_REGION: local
          S3_ACCESS_KEY: dummy-access-key
          S3_SECRET_KEY: dummy-secret-key
      - name: Run the RLS suite
        run: npm run test:rls
```

- [ ] **Step 2: Do NOT make it required yet**

Leave the branch ruleset alone in this PR. Making a check required before its workflow exists on `main` wedges every other open PR, because they have no such check to report. Promotion is a separate step after this merges — see Task 7, Step 4.

- [ ] **Step 3: Verify on a real CI run**

There is no meaningful local check for this — push the branch and confirm on the PR that the `RLS`
job appears, starts a stack, and goes green.

That run is the only real verification: a local pass proves the tests work against _your_ Docker,
not that `supabase start` succeeds on a clean runner with dummy `env()` values. Expect the first
run to be slow (image pulls). If it fails, read the `Start a local stack` step's log before
touching the tests — the likely causes are a missing `env()` variable or the `-x` service list,
neither of which is a test problem.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: run the RLS suite against a local Supabase stack"
```

---

### Task 7: Documentation

**Files:**

- Modify: `AGENTS.md`, `README.md`, `ROADMAP.md`, `CHANGELOG.md`

- [ ] **Step 1: Document the layer in `AGENTS.md`**

Add a section after the "When changing the schema" section:

```markdown
## Testing layers

`npm test` is the fast unit/component suite: Vitest under jsdom with Supabase mocked, and it is
**hermetic by contract** — it must never need Docker, a database, or a network. `vite.config.ts`
injects dummy `VITE_SUPABASE_*` values to enforce that, pointed at an unbindable port so an
unmocked call fails loudly rather than reaching the local stack. Keep `tests/**` excluded from
that project.

`npm run test:rls` is a **separate Vitest project** (`vitest.rls.config.ts`) running integration
tests in `tests/rls/` against a real local stack — start one with `npm run test:rls:up`. It is
where the authorization boundary is actually exercised: RLS is the only thing standing between
one user's rows and another's, and every unit test mocks it away. Four of its tests are
schema-wide catch-alls that need no knowledge of any particular table (RLS enabled everywhere,
every RLS-enabled table has a policy, no security-definer views, every table reachable by the
Data API roles) — those are what keep working as the schema grows. One of the four, the
definer-view check, asserts over an **empty set** today because `public` holds no views, so the
option-spelling parser it depends on lives in `tests/rls/reloptions.ts` and is tested directly in
`reloptions.test.ts` — the same split that makes `src/sw/policy.ts` testable when `src/sw.ts`
itself cannot be, but the parity is not exact: `policy.test.ts` runs inside `npm test`, the
**required** `Test` job, on every PR, while `reloptions.test.ts` runs only under `npm run
test:rls` — a job that is not required and has, as of this writing, never executed in CI. Until
that changes, `isSecurityInvoker` has real test coverage on paper but nothing gating a merge on
it. The CLI is pinned as an exact
`supabase` devDependency rather than through `supabase/setup-cli`, because every call goes
through `npx`, which ignores a PATH binary in favour of a local one and otherwise installs
`latest`.

**Data API grants are explicit, per table, full stop** (`20260729100000_explicit_data_api_grants.sql`)
and must stay that way. `config.toml` leaves `auto_expose_new_tables` unset, so a new table is
unreachable through PostgREST until it is granted — and that compatibility flag is removed on
2026-10-30. The migration deliberately carries no `alter default privileges`: that clause would
auto-grant every table some future migration creates, forever, which turns "forgot to enable RLS
on a new table" into a silently world-readable table instead of a loud `42501` — the opposite of
this repo's default-deny model. A migration that adds a table must grant it explicitly right there;
the fourth structural test (`tests/rls/structure.test.ts`, "every table in public is reachable by
the Data API roles") is the backstop that catches one that doesn't. Note `anon` is granted
deliberately: RLS, not the grant, is what denies it, and `useSettings` depends on an
unauthenticated select returning zero rows rather than an error.
```

> **Post-execution note:** the `AGENTS.md` text above reflects the final, shipped state after the
> 2026-07-29 fix wave. The version originally drafted here (which promised `alter default
> privileges` made "forgetting survivable," and drew an exact parity with `src/sw/policy.ts`) was
> corrected before merge; see the Task 1 post-execution note and `AGENTS.md`'s own history for why.

- [ ] **Step 2: Add the commands to `README.md`**

The commands live in a markdown **table** under `## Scripts` (`README.md:129-138`), not a bash
block. Add three rows after `npm run test:watch`, keeping the existing column alignment:

```markdown
| `npm run test:rls:up`   | Start a local Supabase stack for the RLS tests (Docker) |
| `npm run test:rls`      | Run the RLS integration tests against that stack        |
| `npm run test:rls:down` | Stop the local stack                                    |
```

Prettier reformats the whole table's padding, so run `npm run format` if the alignment drifts —
though note `README.md` is outside the format globs, so this is cosmetic only.

- [ ] **Step 3: Add the changelog entry**

Confirm the target version first: `node scripts/next-version.mjs` → expected `1.2.38`. Add at the top of the released list:

```markdown
## [1.2.38] - 2026-07-29

### Internal

- Row-Level Security — the only thing isolating one account's tasks and settings from another's —
  now has automated tests. They run against a real local Postgres, covering cross-user isolation,
  forged ownership on insert and update, anonymous access, and four schema-wide checks that fail
  if any future table ships without RLS, without a policy, or without its Data API grants.
- Data API grants are now explicit in a migration. Supabase is retiring the compatibility setting
  that auto-exposed new tables on 2026-10-30; without this, any table added after that date would
  have been unreachable by the app despite correct RLS policies.
```

Update the compare links at the bottom: point `[Unreleased]` at `compare/v1.2.38...HEAD` and add `[1.2.38]: .../compare/v1.2.37...v1.2.38`.

- [ ] **Step 4: Record the follow-up promotion**

Add a line to `ROADMAP.md` noting that `RLS` should be promoted to a required check once it has reported green on a few PRs, and that Part 2 (Playwright) is specced in
`docs/superpowers/specs/2026-07-28-test-coverage-rls-and-e2e-design.md`.

Promotion itself is `gh api -X PUT repos/jwh3times/magic-agenda/rulesets/18273908` sending the **full** rules array — the legacy branch-protection API 404s on this repo. Do it only after this PR merges and the job has proven it reports.

- [ ] **Step 5: Verify and commit**

```bash
node scripts/check-changelog.mjs
npm run codex:check
git add AGENTS.md README.md ROADMAP.md CHANGELOG.md
git commit -m "docs: RLS integration tests and explicit Data API grants (v1.2.38)"
```

---

## Final Verification

- [ ] `npm test` — 48 files / 357 tests, unchanged, with **no** stack running
- [ ] `npm run test:rls:up && npm run test:rls` — 20 tests pass
- [ ] `npm run format:check && npm run lint && npx tsc -b && npm run build` — clean
- [ ] `node scripts/check-changelog.mjs` and `npm run codex:check` — pass
- [ ] The `RLS` job appears and is green on the PR
- [ ] `npm run test:rls:down` to release the Docker resources
- [ ] Open the PR with the `ship` skill ("ship it")
- [ ] **After merge:** promote `RLS` to a required check via the ruleset API
