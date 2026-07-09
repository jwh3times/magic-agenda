# Phase 0 + Phase 1 Foundations Implementation Plan

> **Status: Shipped 2026-07-05.** Historical planning record, kept for reference — checkboxes,
> instructions, and constraints reflect the moment the plan was written, not current state (some
> guidance here was superseded by later plans). For what shipped see
> [CHANGELOG.md](../../CHANGELOG.md); for current architecture see [AGENTS.md](../../AGENTS.md).

**Goal:** Land the five foundation items from ROADMAP.md — 0.1 Edge Function scaffolding, 0.2 Settings page shell, 1.1 Password reset, 1.2 Delete account, 1.3 Realtime multi-device sync — as five independent PRs.

**Architecture:** Pure React 19 + TypeScript SPA on Supabase (Postgres + Auth + Realtime + Edge Functions), deployed to Cloudflare Pages. RLS is the only authorization boundary; anything needing service-role privileges (deleting auth users) lives in a Deno Edge Function that verifies the caller's JWT first. Realtime uses `postgres_changes` fed through a pure, unit-tested reducer with self-echo suppression.

**Tech Stack:** React 19, react-router-dom 7, @supabase/supabase-js 2.110, Vitest 4 + Testing Library (jsdom), Deno 2 for edge functions, GitHub Actions CI.

## Global Constraints

- `main` is PR-only (no direct pushes, no admin bypass). Each Part below is **one branch + one PR**; Format / Test / Build + CodeQL must pass; self-merge once green (0 approvals required).
- Merging to `main` deploys production: app via Cloudflare Pages, migrations via `Deploy Migrations`, and (after Part A) functions via `Deploy Functions`.
- Before every commit: `npm test` and `npm run lint` must pass. Run `npm run format` before committing (local `format:check` can false-fail on CRLF — CI is authoritative; see project memory).
- Commit messages: plain imperative subjects (repo style, no `feat:` prefixes), ending with the line `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` when Claude authors the commit.
- All app↔DB conversions stay in `src/data/mappers.ts`. No schema changes in this plan except one migration in Part E (a publication change — **no type regeneration needed**, table shapes don't change).
- Recurrence invariants: templates stay in `templatesRef` (never in the board `tasks` list); instance identity is `(recur_parent_id, recur_origin_day)`; deletions go through `recurSkip`.
- Optimistic writes with rollback (the `useTasks` pattern): local state first, persist, restore `prev` + `setError` on failure.
- Form fields that appear on phones use ≥16px font (iOS Safari zoom).
- Test-first for all pure logic; UI gets Testing Library coverage.
- Node ≥ 26 (`.nvmrc` = 26). Deno 2.x needed locally only for Parts A/D function tests (`winget install DenoLand.Deno`); CI runs them regardless.

## PR sequencing

| Part | Roadmap item | Branch | Depends on |
| ---- | ------------------------------ | ------------------------------ | ---------- |
| A | 0.1 Edge Function scaffolding | `feat/edge-function-scaffolding` | — |
| B | 0.2 Settings page shell | `feat/settings-page-shell` | — |
| C | 1.1 Password reset | `feat/password-reset` | — |
| D | 1.2 Delete account | `feat/delete-account` | A + B merged |
| E | 1.3 Realtime sync | `feat/realtime-sync` | — (merge last anyway) |

A, B, C are mutually independent. D branches from `main` only after A and B are merged.

---

# Part A — 0.1 Edge Function scaffolding (PR 1)

New top-level surface: `supabase/functions/`. Establishes the JWT-verification auth pattern, CORS handling, Deno tests in CI, and auto-deploy on merge. The `hello` function is a live template for Part D.

**Why the tooling excludes matter:** `tsc -b` only includes `src/` (safe), but `eslint.config.js` lints `**/*.{ts,tsx}` and Vitest's default include picks up any `*.test.ts` — both would choke on Deno code (`Deno` global, `jsr:` imports). Task A3 adds the excludes.

### Task A1: Branch + shared function utilities (`cors.ts`, `auth.ts`) with Deno tests

**Files:**
- Create: `supabase/functions/_shared/cors.ts`
- Create: `supabase/functions/_shared/auth.ts`
- Test: `supabase/functions/_shared/auth.test.ts`

**Interfaces:**
- Produces: `corsHeaders: Record<string, string>`; `bearerToken(header: string | null): string | null`; `requireUser(req: Request): Promise<User | Response>` — returns the authenticated Supabase `User`, or a ready-to-return 401 `Response`. Callers check `instanceof Response`.

- [ ] **Step 1: Create the branch**

```bash
git checkout main && git pull --ff-only
git checkout -b feat/edge-function-scaffolding
```

- [ ] **Step 2: Write the failing Deno test**

Create `supabase/functions/_shared/auth.test.ts`:

```ts
import { assertEquals } from 'jsr:@std/assert@1'
import { bearerToken, requireUser } from './auth.ts'

Deno.test('bearerToken extracts the token from a Bearer header', () => {
  assertEquals(bearerToken('Bearer abc.def.ghi'), 'abc.def.ghi')
  assertEquals(bearerToken('bearer abc'), 'abc') // case-insensitive scheme
})

Deno.test('bearerToken returns null for missing or malformed headers', () => {
  assertEquals(bearerToken(null), null)
  assertEquals(bearerToken(''), null)
  assertEquals(bearerToken('Basic dXNlcjpwYXNz'), null)
})

Deno.test('requireUser returns a 401 Response when there is no Authorization header', async () => {
  const result = await requireUser(new Request('http://localhost/'))
  if (!(result instanceof Response)) throw new Error('expected a Response')
  assertEquals(result.status, 401)
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd supabase/functions && deno test`
Expected: FAIL — `Module not found ".../auth.ts"`.

- [ ] **Step 4: Implement `cors.ts` and `auth.ts`**

Create `supabase/functions/_shared/cors.ts`:

```ts
/**
 * CORS headers for browser-invoked functions. The app origin varies
 * (production, Pages previews, localhost), so allow any origin — authorization
 * comes from the JWT, never from the origin.
 */
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
```

Create `supabase/functions/_shared/auth.ts`:

```ts
import { createClient, type User } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders } from './cors.ts'

/** Extract the token from a `Bearer <jwt>` Authorization header value, or null. */
export function bearerToken(header: string | null): string | null {
  if (!header) return null
  const match = header.match(/^Bearer\s+(.+)$/i)
  return match ? match[1] : null
}

function unauthorized(message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 401,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

/**
 * Resolve the calling user from the request's JWT, or return a 401 Response.
 * Verified in-function (defense in depth) even though the platform gateway also
 * checks the JWT when verify_jwt = true. The service-role key must only ever be
 * used AFTER this check succeeds.
 */
export async function requireUser(req: Request): Promise<User | Response> {
  const jwt = bearerToken(req.headers.get('Authorization'))
  if (!jwt) return unauthorized('Missing bearer token')
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
  )
  const { data, error } = await supabase.auth.getUser(jwt)
  if (error || !data.user) return unauthorized('Invalid or expired token')
  return data.user
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd supabase/functions && deno test`
Expected: PASS — 3 tests. (First run downloads `jsr:` deps; needs network.)

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/
git commit -m "Add shared edge-function auth and CORS utilities"
```

### Task A2: The `hello` template function

**Files:**
- Create: `supabase/functions/hello/handler.ts`
- Create: `supabase/functions/hello/index.ts`
- Test: `supabase/functions/hello/handler.test.ts`
- Modify: `supabase/config.toml` (append at end of file)

**Interfaces:**
- Consumes: `requireUser`, `corsHeaders` from Task A1.
- Produces: the handler/index split pattern — `handler(req: Request): Promise<Response>` exported from `handler.ts` (testable without starting a server); `index.ts` contains only `Deno.serve(handler)`. Part D copies this pattern.

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/hello/handler.test.ts`:

```ts
import { assertEquals } from 'jsr:@std/assert@1'
import { handler } from './handler.ts'

Deno.test('OPTIONS preflight succeeds without auth', async () => {
  const res = await handler(new Request('http://localhost/', { method: 'OPTIONS' }))
  assertEquals(res.status, 200)
  assertEquals(res.headers.get('Access-Control-Allow-Origin'), '*')
})

Deno.test('rejects an unauthenticated request with 401', async () => {
  const res = await handler(new Request('http://localhost/', { method: 'POST' }))
  assertEquals(res.status, 401)
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd supabase/functions && deno test`
Expected: FAIL — `Module not found ".../handler.ts"`.

- [ ] **Step 3: Implement the function**

Create `supabase/functions/hello/handler.ts`:

```ts
import { requireUser } from '../_shared/auth.ts'
import { corsHeaders } from '../_shared/cors.ts'

export async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const user = await requireUser(req)
  if (user instanceof Response) return user
  return new Response(JSON.stringify({ message: `Hello ${user.email ?? user.id}` }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
```

Create `supabase/functions/hello/index.ts`:

```ts
import { handler } from './handler.ts'

Deno.serve(handler)
```

Append to `supabase/config.toml` (at the end of the file):

```toml
[functions.hello]
verify_jwt = true
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd supabase/functions && deno test`
Expected: PASS — 5 tests total.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/hello/ supabase/config.toml
git commit -m "Add hello edge function as the JWT-verified function template"
```

### Task A3: Keep Node tooling away from Deno code; add Functions CI job

**Files:**
- Modify: `eslint.config.js:8` (the `ignores` entry)
- Modify: `vite.config.ts` (test.exclude)
- Modify: `.github/workflows/ci.yml` (new job)

- [ ] **Step 1: Verify the current breakage**

Run: `npm run lint`
Expected: errors/warnings reported inside `supabase/functions/**` (TS parser or rule failures on Deno idioms). Also run `npm test` — Vitest tries to collect `supabase/functions/**/*.test.ts` and fails on `jsr:` imports. (If either happens to pass, the excludes below are still required as a guard; proceed.)

- [ ] **Step 2: Add the excludes**

In `eslint.config.js`, change:

```js
  { ignores: ['dist'] },
```

to:

```js
  // supabase/functions is Deno code (Deno globals, jsr: imports) — deno test type-checks it.
  { ignores: ['dist', 'supabase/functions'] },
```

In `vite.config.ts`, change the imports and `test` block:

```ts
import { configDefaults, defineConfig } from 'vitest/config'
```

and inside `test: { ... }` add:

```ts
    // Deno tests, not Vitest tests — run with `deno test` from inside supabase/functions.
    exclude: [...configDefaults.exclude, 'supabase/functions/**'],
```

- [ ] **Step 3: Verify lint and tests pass again**

Run: `npm run lint && npm test`
Expected: both PASS; Vitest collects no files under `supabase/`.

- [ ] **Step 4: Add the Functions job to CI**

In `.github/workflows/ci.yml`, append after the `Build` job (same indentation as the other jobs):

```yaml
  Functions:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: denoland/setup-deno@v2
        with:
          deno-version: v2.x
      - run: cd supabase/functions && deno test
```

- [ ] **Step 5: Commit**

```bash
git add eslint.config.js vite.config.ts .github/workflows/ci.yml
git commit -m "Exclude Deno function code from Node tooling and test it in CI"
```

### Task A4: Deploy Functions workflow, docs, and PR

**Files:**
- Create: `.github/workflows/deploy-functions.yml`
- Modify: `CONTRIBUTING.md` (new subsection under "Project layout" or after "Conventions to honour")
- Modify: `CHANGELOG.md` (under `## [Unreleased]` → `### Internal`)

- [ ] **Step 1: Create the deploy workflow**

Create `.github/workflows/deploy-functions.yml` (mirrors `deploy-migrations.yml`; functions deploy needs the access token + project ref, not the DB password):

```yaml
name: Deploy Functions

# Deploys Supabase Edge Functions to production automatically when a function
# changes on `main` (i.e. when a PR touching supabase/functions/** is merged).
#
# Requires these repository secrets (already set for Deploy Migrations):
#   SUPABASE_ACCESS_TOKEN  - personal access token
#   SUPABASE_PROJECT_ID    - the project ref (the <ref> in <ref>.supabase.co)
#
# `supabase functions deploy` with no name deploys every function in
# supabase/functions/, so re-runs are safe.

on:
  push:
    branches: [main]
    paths:
      - 'supabase/functions/**'
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: deploy-functions
  cancel-in-progress: false

jobs:
  Deploy:
    runs-on: ubuntu-latest
    env:
      SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
      SUPABASE_PROJECT_ID: ${{ secrets.SUPABASE_PROJECT_ID }}
    steps:
      - uses: actions/checkout@v7
      - uses: supabase/setup-cli@v1
        with:
          version: latest
      - run: supabase functions deploy --project-ref "$SUPABASE_PROJECT_ID"
```

- [ ] **Step 2: Document the function workflow in CONTRIBUTING.md**

Add this section to `CONTRIBUTING.md` after the "Conventions to honour" section:

```markdown
## Edge functions

Server-side code lives in `supabase/functions/` (Deno 2, not Node). Each function is a
directory with `handler.ts` (the exported, testable request handler) and `index.ts`
(just `Deno.serve(handler)`); shared helpers live in `supabase/functions/_shared/`.
Every function verifies the caller's JWT via `requireUser()` before doing anything,
and only uses the service-role key after that check.

- Test: `cd supabase/functions && deno test` (the CI `Functions` job runs this).
- Serve locally: `npx supabase start` (needs Docker), then `npx supabase functions serve <name>`.
- Deploy: automatic on merge to `main` via the `Deploy Functions` workflow.

Node tooling deliberately ignores this directory (`eslint.config.js` ignores,
Vitest `test.exclude`) — Deno code doesn't parse under the Node toolchain.
```

- [ ] **Step 3: Add the CHANGELOG entry**

In `CHANGELOG.md` under `## [Unreleased]` → `### Internal`, add as the first bullet:

```markdown
- **Edge Function scaffolding** — `supabase/functions/` with a shared JWT-verification helper
  (`requireUser`), CORS handling, a `hello` template function, Deno tests in a new CI `Functions`
  job, and a `Deploy Functions` workflow that ships functions to production on merge to `main`.
```

- [ ] **Step 4: Full local verification**

Run: `npm test && npm run lint && npm run build && cd supabase/functions && deno test`
Expected: all PASS.

- [ ] **Step 5: Commit, push, open the PR**

```bash
git add .github/workflows/deploy-functions.yml CONTRIBUTING.md CHANGELOG.md
git commit -m "Add Deploy Functions workflow and contributor docs for edge functions"
git push -u origin feat/edge-function-scaffolding
gh pr create --title "Edge Function scaffolding (roadmap 0.1)" --body "Adds supabase/functions/ with the JWT-verified auth pattern, a hello template function, Deno tests in CI, and auto-deploy on merge. Unblocks delete-account (1.2), iCal (6.1), push reminders (3.2). No app code or schema changes."
```

Wait for checks, merge, then verify the `Deploy Functions` workflow run succeeds (Actions tab). **Manual (optional):** add the `Functions` job to the branch-protection required checks.

---

# Part B — 0.2 Settings page shell (PR 2)

A protected `/settings` route with a section registry later items append to (Danger zone in Part D; export/import, week-start/timezone, labels later). Moves nothing away from the toolbar — settings *duplicates* the theme/default-view controls. Includes the Privacy/Terms footer links (roadmap 5.3, first half).

### Task B1: `SettingsPage` component, test-first

**Files:**
- Create: `src/pages/SettingsPage.tsx`
- Test: `src/pages/SettingsPage.test.tsx`

**Interfaces:**
- Consumes: `useAuth()` (`src/auth/AuthProvider.tsx`), `useSettings(userId)` (`src/data/useSettings.ts`), `ThemeProvider`/`useTheme` (`src/theme/ThemeProvider.tsx`), `ThemeSwitcher` (no props), `useIsMobile()`, `Spinner`.
- Produces: `export function SettingsPage()`; an internal `SECTIONS: SettingsSection[]` registry where `interface SettingsSection { id: string; title: string; render: (ctx: SectionContext) => ReactNode }` and `interface SectionContext { defaultView: ViewName; onChangeView: (v: ViewName) => void }`. Part D appends a section to `SECTIONS`.

- [ ] **Step 1: Write the failing test**

Create `src/pages/SettingsPage.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => {
  const upsert = vi.fn(() => ({
    then: (onFulfilled: (r: { data: null; error: null }) => unknown) =>
      Promise.resolve({ data: null, error: null }).then(onFulfilled),
  }))
  const maybeSingle = vi.fn(() =>
    Promise.resolve({ data: { theme: 'cork', default_view: 'calendar' }, error: null }),
  )
  return { upsert, maybeSingle }
})

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: h.maybeSingle })) })),
      upsert: h.upsert,
    })),
  },
}))

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({
    user: { id: 'user-1' },
    session: {},
    loading: false,
    signOut: vi.fn(),
  }),
}))

import { SettingsPage } from './SettingsPage'

beforeEach(() => h.upsert.mockClear())

function renderPage() {
  return render(
    <MemoryRouter>
      <SettingsPage />
    </MemoryRouter>,
  )
}

test('renders the Appearance section with theme and default-view controls', async () => {
  renderPage()
  expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Appearance' })).toBeInTheDocument()
  expect(screen.getByLabelText('Default view')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: '← Board' })).toHaveAttribute('href', '/')
})

test('changing the default view persists it', async () => {
  renderPage()
  const select = await screen.findByLabelText('Default view')
  await userEvent.selectOptions(select, 'kanban')
  expect(h.upsert).toHaveBeenCalledWith(
    { user_id: 'user-1', theme: 'cork', default_view: 'kanban' },
    { onConflict: 'user_id' },
  )
})

test('links to the legal pages from the footer', async () => {
  renderPage()
  expect(await screen.findByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '/privacy')
  expect(screen.getByRole('link', { name: 'Terms' })).toHaveAttribute('href', '/terms')
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/pages/SettingsPage.test.tsx`
Expected: FAIL — cannot resolve `./SettingsPage`.

- [ ] **Step 3: Implement `SettingsPage`**

Create `src/pages/SettingsPage.tsx`:

```tsx
import { type CSSProperties, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { ThemeProvider, useTheme } from '../theme/ThemeProvider'
import { ThemeSwitcher } from '../components/ThemeSwitcher'
import { Spinner } from '../components/Spinner'
import { useSettings } from '../data/useSettings'
import { useIsMobile } from '../lib/useMediaQuery'
import type { ViewName } from '../types/task'

export interface SectionContext {
  defaultView: ViewName
  onChangeView: (v: ViewName) => void
}

export interface SettingsSection {
  id: string
  title: string
  render: (ctx: SectionContext) => ReactNode
}

// Later features append here (Danger zone, export/import, week-start/timezone, labels…).
const SECTIONS: SettingsSection[] = [
  { id: 'appearance', title: 'Appearance', render: (ctx) => <AppearanceSection {...ctx} /> },
]

/** The protected /settings route: owns its own settings state + theme, like BoardPage. */
export function SettingsPage() {
  const { user } = useAuth()
  const userId = user?.id ?? ''
  const { settings, loading, saveTheme, saveView } = useSettings(userId)

  if (!user || loading || !settings) return <Spinner />

  return (
    <ThemeProvider initial={settings.theme} onThemeChange={saveTheme}>
      <SettingsShell defaultView={settings.defaultView} onChangeView={saveView} />
    </ThemeProvider>
  )
}

function SettingsShell({ defaultView, onChangeView }: SectionContext) {
  const { conf } = useTheme()
  const isMobile = useIsMobile()

  const card: CSSProperties = {
    background: conf.cellBg,
    border: conf.cellBorder,
    borderRadius: conf.cellRadius,
    padding: isMobile ? 14 : 18,
  }

  return (
    <div
      style={{
        minHeight: '100%',
        background: conf.pageBg,
        backgroundImage: conf.pageImg,
        backgroundSize: conf.pageSize,
        fontFamily: conf.ui,
        color: conf.numFg,
        padding: isMobile ? 14 : 28,
      }}
    >
      <div
        style={{
          maxWidth: 640,
          margin: '0 auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        <header style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
          <Link to="/" style={{ color: 'inherit', textDecoration: 'none', fontWeight: 700 }}>
            ← Board
          </Link>
          <h1 style={{ fontFamily: conf.title, fontSize: isMobile ? 26 : 32, margin: 0 }}>
            Settings
          </h1>
        </header>

        {SECTIONS.map((s) => (
          <section key={s.id} aria-labelledby={`settings-${s.id}`} style={card}>
            <h2
              id={`settings-${s.id}`}
              style={{ margin: '0 0 12px', fontSize: 17, fontFamily: conf.title }}
            >
              {s.title}
            </h2>
            {s.render({ defaultView, onChangeView })}
          </section>
        ))}

        <footer style={{ fontSize: 13, opacity: 0.7, display: 'flex', gap: 14 }}>
          <Link to="/privacy" style={{ color: 'inherit' }}>
            Privacy
          </Link>
          <Link to="/terms" style={{ color: 'inherit' }}>
            Terms
          </Link>
        </footer>
      </div>
    </div>
  )
}

function AppearanceSection({ defaultView, onChangeView }: SectionContext) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <div style={{ fontSize: 13, opacity: 0.7, marginBottom: 6 }}>Theme</div>
        <ThemeSwitcher />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label htmlFor="settings-default-view" style={{ fontSize: 13, opacity: 0.7 }}>
          Default view
        </label>
        <select
          id="settings-default-view"
          value={defaultView}
          onChange={(e) => onChangeView(e.target.value as ViewName)}
          // ≥16px so iOS Safari doesn't zoom on focus.
          style={{ fontSize: 16, padding: '8px 10px', maxWidth: 240 }}
        >
          <option value="calendar">Calendar</option>
          <option value="week">Week</option>
          <option value="agenda">Agenda</option>
          <option value="kanban">Kanban</option>
        </select>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/pages/SettingsPage.test.tsx`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git checkout main && git pull --ff-only && git checkout -b feat/settings-page-shell
git add src/pages/SettingsPage.tsx src/pages/SettingsPage.test.tsx
git commit -m "Add the /settings page shell with a section registry"
```

(If the branch was already created, skip the checkout line.)

### Task B2: Route + toolbar gear button

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/Toolbar.tsx`
- Modify: `src/components/Board.tsx` (prop threading)
- Modify: `src/pages/BoardPage.tsx` (prop threading)
- Test: `src/components/Toolbar.test.tsx` (new)

**Interfaces:**
- Produces: optional prop `onOpenSettings?: () => void` on `ToolbarProps` and `BoardProps`, threaded `BoardPage → Board → Toolbar`.

- [ ] **Step 1: Write the failing Toolbar test**

Create `src/components/Toolbar.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { ThemeProvider } from '../theme/ThemeProvider'
import { Toolbar } from './Toolbar'

test('the settings gear invokes onOpenSettings', async () => {
  const onOpenSettings = vi.fn()
  render(
    <ThemeProvider>
      <Toolbar
        views={[{ key: 'calendar', label: 'Calendar' }]}
        view="calendar"
        onChangeView={() => {}}
        showNav={false}
        navLabel=""
        onPrev={() => {}}
        onNext={() => {}}
        onToday={() => {}}
        onAddInbox={() => {}}
        onOpenSettings={onOpenSettings}
      />
    </ThemeProvider>,
  )
  await userEvent.click(screen.getByRole('button', { name: 'Settings' }))
  expect(onOpenSettings).toHaveBeenCalledTimes(1)
})
```

(`ViewOption` is `{ key: ViewName; label: string }` — see `src/components/ViewSwitcher.tsx:5`.)

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/components/Toolbar.test.tsx`
Expected: FAIL — no button named "Settings".

- [ ] **Step 3: Add the gear to `Toolbar`**

In `src/components/Toolbar.tsx`:

1. Add to `ToolbarProps` (after `onSignOut?: () => void`):

```ts
  onOpenSettings?: () => void
```

2. Add `onOpenSettings` to the destructured props in the function signature.

3. **Mobile branch** — inside the first row `<div>` (the one with the logo and `+ New task`), insert *before* the Sign out button:

```tsx
          {onOpenSettings && (
            <button
              type="button"
              onClick={onOpenSettings}
              aria-label="Settings"
              title="Settings"
              style={{ ...c.todayBtn, flex: 'none' }}
            >
              ⚙
            </button>
          )}
```

4. **Desktop branch** — in the right-hand group (`<div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>`), insert between `<ThemeSwitcher />` and the `+ New task` button:

```tsx
        {onOpenSettings && (
          <button
            type="button"
            onClick={onOpenSettings}
            aria-label="Settings"
            title="Settings"
            style={c.todayBtn}
          >
            ⚙
          </button>
        )}
```

- [ ] **Step 4: Thread the prop through `Board` and `BoardPage`**

In `src/components/Board.tsx`:
- Add `onOpenSettings?: () => void` to `BoardProps` (next to `onSignOut?: () => void`, around line 45).
- Add `onOpenSettings` to the destructuring (around line 86).
- Pass it in the `<Toolbar …>` call (around line 194): `onOpenSettings={onOpenSettings}`.

In `src/pages/BoardPage.tsx`:

```tsx
import { useNavigate } from 'react-router-dom'
```

Inside `BoardPage()` add `const navigate = useNavigate()`, and on the `<Board …>` element add:

```tsx
            onOpenSettings={() => navigate('/settings')}
```

- [ ] **Step 5: Add the lazy route in `src/App.tsx`**

After the `BoardPage` lazy declaration:

```tsx
const SettingsPage = lazy(() =>
  import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })),
)
```

Inside `<Routes>`, before the `/` route:

```tsx
          <Route
            path="/settings"
            element={
              <ProtectedRoute>
                <Suspense fallback={<Spinner label="Loading…" />}>
                  <SettingsPage />
                </Suspense>
              </ProtectedRoute>
            }
          />
```

- [ ] **Step 6: Run all tests and the dev server**

Run: `npm test`
Expected: PASS (including the new Toolbar test; `Board.test.tsx` unaffected — the new prop is optional).

Run: `npm run dev` — sign in, click the gear, verify /settings renders in all three themes, change theme + default view, reload the board and confirm both stuck. Check phone width (devtools) — gear sits in row 1.

- [ ] **Step 7: Commit**

```bash
git add src/App.tsx src/components/Toolbar.tsx src/components/Toolbar.test.tsx src/components/Board.tsx src/pages/BoardPage.tsx
git commit -m "Route /settings and add a toolbar gear to reach it"
```

### Task B3: CHANGELOG + PR

**Files:**
- Modify: `CHANGELOG.md` (under `## [Unreleased]` → `### Added`)

- [ ] **Step 1: CHANGELOG entry**

Add under `### Added`:

```markdown
- **Settings page** — a `/settings` route (gear button in the toolbar) with theme and
  default-view controls and Privacy/Terms links; built as a section registry that account,
  data, and preference features will extend.
```

- [ ] **Step 2: Full verification**

Run: `npm test && npm run lint && npm run build`
Expected: all PASS.

- [ ] **Step 3: Commit, push, PR**

```bash
git add CHANGELOG.md
git commit -m "Add settings page changelog entry"
git push -u origin feat/settings-page-shell
gh pr create --title "Settings page shell (roadmap 0.2)" --body "Protected /settings route with a section registry (Appearance: theme + default view), toolbar gear entry point, and Privacy/Terms footer links (first half of roadmap 5.3). No schema changes."
```

Wait for checks, merge.

---

# Part C — 1.1 Password reset (PR 3)

Two halves: request (Login gains a `forgot` mode) and complete (new `/auth/reset` page). A `PASSWORD_RECOVERY` listener plus a `ProtectedRoute` redirect guarantee a recovery session can't land on the board silently.

### Task C1: `passwordRecovery` state in AuthProvider + ProtectedRoute redirect, test-first

**Files:**
- Modify: `src/auth/AuthProvider.tsx`
- Modify: `src/auth/ProtectedRoute.tsx`
- Test: `src/auth/ProtectedRoute.test.tsx` (new)

**Interfaces:**
- Produces: `AuthContextValue` gains `passwordRecovery: boolean` and `clearPasswordRecovery: () => void`. `ProtectedRoute` redirects to `/auth/reset` while `passwordRecovery` is true.

- [ ] **Step 1: Write the failing test**

Create `src/auth/ProtectedRoute.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { expect, test, vi } from 'vitest'

const auth = vi.hoisted(() => ({
  current: {
    session: { user: { id: 'u1' } } as unknown,
    user: { id: 'u1' } as unknown,
    loading: false,
    passwordRecovery: false,
    clearPasswordRecovery: vi.fn(),
    signOut: vi.fn(),
  },
}))

vi.mock('./AuthProvider', () => ({ useAuth: () => auth.current }))

import { ProtectedRoute } from './ProtectedRoute'

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <div>the board</div>
            </ProtectedRoute>
          }
        />
        <Route path="/auth/reset" element={<div>reset page</div>} />
        <Route path="/login" element={<div>login page</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

test('renders children for a normal session', () => {
  auth.current.passwordRecovery = false
  renderAt('/')
  expect(screen.getByText('the board')).toBeInTheDocument()
})

test('redirects a recovery session to /auth/reset instead of the board', () => {
  auth.current.passwordRecovery = true
  renderAt('/')
  expect(screen.getByText('reset page')).toBeInTheDocument()
  expect(screen.queryByText('the board')).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/auth/ProtectedRoute.test.tsx`
Expected: the first test passes, the second FAILS (finds "the board").

- [ ] **Step 3: Implement**

In `src/auth/AuthProvider.tsx`:

1. Extend the imports: `import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'`
2. Extend the interface:

```ts
interface AuthContextValue {
  session: Session | null
  user: User | null
  loading: boolean
  /** True while the session came from a password-recovery link and hasn't set a new password. */
  passwordRecovery: boolean
  clearPasswordRecovery: () => void
  signOut: () => Promise<void>
}
```

3. Inside `AuthProvider`, add state and wire the event (replace the existing `onAuthStateChange` callback):

```ts
  const [passwordRecovery, setPasswordRecovery] = useState(false)
```

```ts
    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next)
      if (event === 'PASSWORD_RECOVERY') setPasswordRecovery(true)
    })
```

4. Add the clear callback and extend the provider value:

```ts
  const clearPasswordRecovery = useCallback(() => setPasswordRecovery(false), [])
```

```tsx
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        loading,
        passwordRecovery,
        clearPasswordRecovery,
        signOut,
      }}
    >
```

In `src/auth/ProtectedRoute.tsx`, replace the body:

```tsx
export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { session, loading, passwordRecovery } = useAuth()
  if (loading) return <Spinner />
  if (!session) return <Navigate to="/login" replace />
  // A recovery-link session must set a new password before reaching the board.
  if (passwordRecovery) return <Navigate to="/auth/reset" replace />
  return <>{children}</>
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/auth/ProtectedRoute.test.tsx`
Expected: PASS — 2 tests. Also run `npm test` (nothing else consumes the new fields yet; `App.test.tsx` must stay green).

- [ ] **Step 5: Commit**

```bash
git checkout main && git pull --ff-only && git checkout -b feat/password-reset
git add src/auth/AuthProvider.tsx src/auth/ProtectedRoute.tsx src/auth/ProtectedRoute.test.tsx
git commit -m "Track password-recovery sessions and keep them off the board"
```

### Task C2: Shared auth-page styles + Login "Forgot password?" mode

**Files:**
- Create: `src/pages/authChrome.ts`
- Modify: `src/pages/Login.tsx`
- Test: `src/pages/Login.test.tsx` (new)

**Interfaces:**
- Produces: `authPage`, `authCard`, `authField: CSSProperties` in `src/pages/authChrome.ts` (extracted verbatim from Login's current inline styles; ResetPassword reuses them in C3). Login `Mode` becomes `'signin' | 'signup' | 'forgot'`.

- [ ] **Step 1: Write the failing test**

Create `src/pages/Login.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
  resetPasswordForEmail: vi.fn(() => Promise.resolve({ data: {}, error: null })),
}))

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      resetPasswordForEmail: h.resetPasswordForEmail,
      signInWithPassword: vi.fn(() => Promise.resolve({ error: null })),
      signUp: vi.fn(() => Promise.resolve({ data: {}, error: null })),
      signInWithOAuth: vi.fn(() => Promise.resolve({ error: null })),
    },
  },
}))

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ session: null, user: null, loading: false }),
}))

import { Login } from './Login'

function renderLogin() {
  return render(
    <MemoryRouter>
      <Login />
    </MemoryRouter>,
  )
}

test('forgot mode hides the password field and sends the reset email', async () => {
  renderLogin()
  await userEvent.click(screen.getByRole('button', { name: 'Forgot password?' }))
  expect(screen.queryByPlaceholderText('Password')).not.toBeInTheDocument()

  await userEvent.type(screen.getByPlaceholderText('you@example.com'), 'a@b.co')
  await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }))

  expect(h.resetPasswordForEmail).toHaveBeenCalledWith('a@b.co', {
    redirectTo: `${window.location.origin}/auth/reset`,
  })
  // Same notice whether or not the account exists — never leak existence.
  expect(
    await screen.findByText(/If an account exists for that email/),
  ).toBeInTheDocument()
})

test('back link returns from forgot mode to sign in', async () => {
  renderLogin()
  await userEvent.click(screen.getByRole('button', { name: 'Forgot password?' }))
  await userEvent.click(screen.getByRole('button', { name: 'Back to sign in' }))
  expect(screen.getByPlaceholderText('Password')).toBeInTheDocument()
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/pages/Login.test.tsx`
Expected: FAIL — no "Forgot password?" button.

- [ ] **Step 3: Extract the shared styles**

Create `src/pages/authChrome.ts` (values copied exactly from `Login.tsx`'s current inline styles):

```ts
import type { CSSProperties } from 'react'

/** Shared styling for the auth pages (Login, ResetPassword) — the dark glass card. */
export const authPage: CSSProperties = {
  minHeight: '100%',
  display: 'grid',
  placeItems: 'center',
  padding: 20,
  background:
    'radial-gradient(1200px 600px at 70% -10%, rgba(124,92,255,.25), transparent 60%), #0b0f1f',
  fontFamily: 'system-ui, sans-serif',
  color: '#eaf0ff',
}

export const authCard: CSSProperties = {
  width: 'min(400px, 100%)',
  background: 'rgba(255,255,255,.04)',
  border: '1px solid rgba(255,255,255,.1)',
  borderRadius: 18,
  padding: 28,
  boxShadow: '0 30px 80px rgba(0,0,0,.45)',
  backdropFilter: 'blur(12px)',
  WebkitBackdropFilter: 'blur(12px)',
}

export const authField: CSSProperties = {
  width: '100%',
  padding: '12px 14px',
  borderRadius: 10,
  border: '1px solid rgba(255,255,255,.12)',
  background: 'rgba(255,255,255,.05)',
  color: '#eaf0ff',
  fontSize: 16, // ≥16px so iOS Safari doesn't zoom on focus
  fontFamily: 'system-ui, sans-serif',
}

export const authSubmit: CSSProperties = {
  marginTop: 4,
  padding: '12px 14px',
  borderRadius: 10,
  border: 'none',
  background: '#7c5cff',
  color: '#fff',
  fontSize: 14,
  fontWeight: 800,
}

export const authLinkBtn: CSSProperties = {
  background: 'none',
  border: 'none',
  color: '#a78bfa',
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 700,
  padding: 0,
}
```

(Note: `authField` bumps `fontSize` from 14 to 16 deliberately — the login form is used on phones. Everything else is verbatim.)

- [ ] **Step 4: Rework `Login.tsx`**

In `src/pages/Login.tsx`:

1. Replace the local `field` const with an import, and drop the local definition:

```ts
import { authCard, authField, authLinkBtn, authPage, authSubmit } from './authChrome'
```

Replace all `style={field}` with `style={authField}`, the outer page `<div style={{ minHeight: '100%', … }}>` with `<div style={authPage}>`, and the card `<div style={{ width: 'min(400px, 100%)', … }}>` with `<div style={authCard}>`. Replace the submit button's style object with `style={{ ...authSubmit, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}` and the mode-toggle button's style object with `style={authLinkBtn}`.

2. Widen the mode type:

```ts
type Mode = 'signin' | 'signup' | 'forgot'
```

3. In `submit`, add the forgot branch at the top of the `try` block:

```ts
      if (mode === 'forgot') {
        const { error: err } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/auth/reset`,
        })
        if (err) throw err
        setNotice('If an account exists for that email, a password reset link is on its way.')
        return
      }
```

4. Update the subtitle copy:

```tsx
        <p style={{ margin: '0 0 22px', opacity: 0.55, fontSize: 14 }}>
          {mode === 'signin'
            ? 'Welcome back — sign in to your board.'
            : mode === 'signup'
              ? 'Create your account.'
              : 'Enter your email and we’ll send you a reset link.'}
        </p>
```

5. Hide the Google button and divider in forgot mode: wrap the Google `<button>` and the `or` divider `<div>` in `{mode !== 'forgot' && (<> … </>)}`.

6. Render the password input and its hint only when `mode !== 'forgot'` (wrap the existing password `<input>` and the signup hint block in `{mode !== 'forgot' && (<> … </>)}`).

7. Add a "Forgot password?" link under the form fields, visible in signin mode only (insert between the password input block and the error/notice block):

```tsx
          {mode === 'signin' && (
            <button
              type="button"
              onClick={() => {
                setMode('forgot')
                setError(null)
                setNotice(null)
              }}
              style={{ ...authLinkBtn, alignSelf: 'flex-end', fontSize: 12 }}
            >
              Forgot password?
            </button>
          )}
```

8. Update the submit button label:

```tsx
            {busy
              ? 'Please wait…'
              : mode === 'signin'
                ? 'Sign in'
                : mode === 'signup'
                  ? 'Create account'
                  : 'Send reset link'}
```

9. Update the mode-toggle footer to handle forgot mode (replace the existing footer `<div>` content):

```tsx
        <div style={{ marginTop: 18, fontSize: 13, opacity: 0.7, textAlign: 'center' }}>
          {mode === 'forgot' ? (
            <button
              type="button"
              onClick={() => {
                setMode('signin')
                setError(null)
                setNotice(null)
              }}
              style={authLinkBtn}
            >
              Back to sign in
            </button>
          ) : (
            <>
              {mode === 'signin' ? "Don't have an account? " : 'Already have an account? '}
              <button
                type="button"
                onClick={() => {
                  setMode(mode === 'signin' ? 'signup' : 'signin')
                  setError(null)
                  setNotice(null)
                }}
                style={authLinkBtn}
              >
                {mode === 'signin' ? 'Sign up' : 'Sign in'}
              </button>
            </>
          )}
        </div>
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/pages/Login.test.tsx && npm test`
Expected: PASS, including `App.test.tsx` (it looks for the "Sign in" button and the email placeholder — both unchanged in signin mode).

- [ ] **Step 6: Commit**

```bash
git add src/pages/authChrome.ts src/pages/Login.tsx src/pages/Login.test.tsx
git commit -m "Add a forgot-password mode to the login page"
```

### Task C3: `/auth/reset` page

**Files:**
- Create: `src/pages/ResetPassword.tsx`
- Modify: `src/App.tsx` (route)
- Test: `src/pages/ResetPassword.test.tsx`

**Interfaces:**
- Consumes: `useAuth()` (`session`, `loading`, `clearPasswordRecovery` from C1), `authPage`/`authCard`/`authField`/`authSubmit` from C2, `supabase.auth.updateUser`.
- Produces: `export function ResetPassword()` mounted at `/auth/reset` (NOT inside `ProtectedRoute` — it handles the no-session case itself, and ProtectedRoute would bounce recovery sessions right back here anyway).

- [ ] **Step 1: Write the failing test**

Create `src/pages/ResetPassword.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
  updateUser: vi.fn(() => Promise.resolve({ data: {}, error: null })),
  clearPasswordRecovery: vi.fn(),
  auth: {
    current: {
      session: { user: { id: 'u1' } } as unknown,
      user: { id: 'u1' } as unknown,
      loading: false,
      passwordRecovery: true,
      clearPasswordRecovery: vi.fn(),
      signOut: vi.fn(),
    },
  },
}))

vi.mock('../lib/supabase', () => ({
  supabase: { auth: { updateUser: h.updateUser } },
}))

vi.mock('../auth/AuthProvider', () => ({ useAuth: () => h.auth.current }))

import { ResetPassword } from './ResetPassword'

beforeEach(() => {
  h.updateUser.mockClear()
  h.auth.current.clearPasswordRecovery = h.clearPasswordRecovery
  h.clearPasswordRecovery.mockClear()
})

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/auth/reset']}>
      <ResetPassword />
    </MemoryRouter>,
  )
}

test('rejects mismatched passwords without calling supabase', async () => {
  h.auth.current.session = { user: { id: 'u1' } }
  renderPage()
  await userEvent.type(screen.getByPlaceholderText('New password'), 'longenough123!')
  await userEvent.type(screen.getByPlaceholderText('Confirm new password'), 'different123!')
  await userEvent.click(screen.getByRole('button', { name: 'Set new password' }))
  expect(await screen.findByText('Passwords do not match.')).toBeInTheDocument()
  expect(h.updateUser).not.toHaveBeenCalled()
})

test('updates the password and clears the recovery flag on success', async () => {
  h.auth.current.session = { user: { id: 'u1' } }
  renderPage()
  await userEvent.type(screen.getByPlaceholderText('New password'), 'longenough123!')
  await userEvent.type(screen.getByPlaceholderText('Confirm new password'), 'longenough123!')
  await userEvent.click(screen.getByRole('button', { name: 'Set new password' }))
  expect(h.updateUser).toHaveBeenCalledWith({ password: 'longenough123!' })
  expect(h.clearPasswordRecovery).toHaveBeenCalled()
})

test('shows the expired-link screen when there is no session', () => {
  h.auth.current.session = null
  renderPage()
  expect(screen.getByText(/invalid or has expired/)).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Back to sign in' })).toHaveAttribute('href', '/login')
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/pages/ResetPassword.test.tsx`
Expected: FAIL — cannot resolve `./ResetPassword`.

- [ ] **Step 3: Implement the page**

Create `src/pages/ResetPassword.tsx`:

```tsx
import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { authCard, authField, authPage, authSubmit } from './authChrome'
import logoDark from '../assets/logo-dark.svg'

// Mirror of Login's SIGNUP_MIN_PASSWORD — the Supabase dashboard policy is the real control.
const MIN_PASSWORD = 10

/**
 * Password-recovery landing page. The recovery link signs the user in
 * (detectSessionInUrl) before they arrive here; ProtectedRoute routes any
 * recovery session here until a new password is set.
 */
export function ResetPassword() {
  const { session, loading, clearPasswordRecovery } = useAuth()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!loading && !session) {
    return (
      <div style={authPage}>
        <div style={authCard}>
          <img
            src={logoDark}
            alt="Magic Agenda"
            style={{ height: 110, display: 'block', margin: '0 0 6px' }}
          />
          <p style={{ margin: '0 0 18px', fontSize: 14, lineHeight: 1.5, opacity: 0.75 }}>
            This password reset link is invalid or has expired. Request a new one from the
            sign-in page.
          </p>
          <Link to="/login" style={{ color: '#a78bfa', fontWeight: 700, fontSize: 14 }}>
            Back to sign in
          </Link>
        </div>
      </div>
    )
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (password.length < MIN_PASSWORD) {
      setError(`Use at least ${MIN_PASSWORD} characters.`)
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    setBusy(true)
    setError(null)
    const { error: err } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (err) {
      setError(err.message)
      return
    }
    clearPasswordRecovery()
    navigate('/', { replace: true })
  }

  return (
    <div style={authPage}>
      <div style={authCard}>
        <img
          src={logoDark}
          alt="Magic Agenda"
          style={{ height: 110, display: 'block', margin: '0 0 6px' }}
        />
        <p style={{ margin: '0 0 22px', opacity: 0.55, fontSize: 14 }}>
          Choose a new password for your account.
        </p>
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
          <input
            type="password"
            required
            minLength={MIN_PASSWORD}
            placeholder="New password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={authField}
          />
          <input
            type="password"
            required
            placeholder="Confirm new password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            style={authField}
          />
          <div style={{ fontSize: 12, opacity: 0.5, lineHeight: 1.4 }}>
            At least 10 characters, including upper- and lower-case letters, a number, and a
            symbol.
          </div>
          {error && <div style={{ color: '#ff8b8b', fontSize: 13, lineHeight: 1.4 }}>{error}</div>}
          <button
            type="submit"
            disabled={busy}
            style={{ ...authSubmit, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}
          >
            {busy ? 'Please wait…' : 'Set new password'}
          </button>
        </form>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Add the route**

In `src/App.tsx`, import and mount (a plain route next to `/auth/callback`):

```tsx
import { ResetPassword } from './pages/ResetPassword'
```

```tsx
          <Route path="/auth/reset" element={<ResetPassword />} />
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/pages/ResetPassword.test.tsx && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/pages/ResetPassword.tsx src/pages/ResetPassword.test.tsx src/App.tsx
git commit -m "Add the /auth/reset password-recovery page"
```

### Task C4: Local auth config, CHANGELOG, PR + manual production steps

**Files:**
- Modify: `supabase/config.toml:163` (`additional_redirect_urls`)
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Allow the local redirect**

In `supabase/config.toml`, change:

```toml
additional_redirect_urls = ["http://localhost:5173/auth/callback"]
```

to:

```toml
additional_redirect_urls = [
  "http://localhost:5173/auth/callback",
  "http://localhost:5173/auth/reset",
]
```

- [ ] **Step 2: CHANGELOG entry**

Under `## [Unreleased]` → `### Added`:

```markdown
- **Password reset** — a "Forgot password?" flow on the login page emails a recovery link
  (never revealing whether an account exists); the link lands on a new `/auth/reset` page
  that sets the new password. A recovery session can't reach the board until the password
  is changed.
```

- [ ] **Step 3: Full verification + manual smoke test**

Run: `npm test && npm run lint && npm run build`
Expected: all PASS.

Manual (local): `npm run dev`, click "Forgot password?", submit your email, open Mailpit at `http://127.0.0.1:54324` (requires `npx supabase start`) *or* skip the local email check and verify on the preview deploy after the PR opens.

- [ ] **Step 4: Commit, push, PR**

```bash
git add supabase/config.toml CHANGELOG.md
git commit -m "Add password reset changelog entry and local redirect allowlist"
git push -u origin feat/password-reset
gh pr create --title "Password reset (roadmap 1.1)" --body "$(cat <<'EOF'
Forgot-password flow: request from Login (generic notice, no account-existence leak) + /auth/reset completion page. PASSWORD_RECOVERY sessions are kept off the board by ProtectedRoute until a new password is set.

## Manual production steps (before/with merge)
- [ ] Supabase dashboard → Authentication → URL Configuration → add `https://magicagenda.app/auth/reset` to Redirect URLs
- [ ] Supabase dashboard → Authentication → Email Templates → customize "Reset Password"
- [ ] After merge: run the flow once against production (request → email → reset → sign in)
EOF
)"
```

Wait for checks, complete the two dashboard steps, merge, then run the production smoke test in the PR checklist.

---

# Part D — 1.2 Delete account (PR 4)

**Branch only after Parts A and B are merged.** Server half: a `delete-account` Edge Function (client can't delete `auth.users` rows). Client half: a "Danger zone" settings section with type-`delete`-to-confirm. `on delete cascade` (init.sql) removes tasks + settings.

### Task D1: `delete-account` function, test-first

**Files:**
- Create: `supabase/functions/delete-account/handler.ts`
- Create: `supabase/functions/delete-account/index.ts`
- Test: `supabase/functions/delete-account/handler.test.ts`
- Modify: `supabase/config.toml` (append)

**Interfaces:**
- Consumes: `requireUser`, `corsHeaders` (Part A).
- Produces: POST-only endpoint; 401 without a valid JWT, 405 for other methods, `{ ok: true }` on success. Client calls it via `supabase.functions.invoke('delete-account', { method: 'POST' })`.

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/delete-account/handler.test.ts`:

```ts
import { assertEquals } from 'jsr:@std/assert@1'
import { handler } from './handler.ts'

Deno.test('OPTIONS preflight succeeds', async () => {
  const res = await handler(new Request('http://localhost/', { method: 'OPTIONS' }))
  assertEquals(res.status, 200)
})

Deno.test('rejects non-POST methods with 405', async () => {
  const res = await handler(new Request('http://localhost/', { method: 'GET' }))
  assertEquals(res.status, 405)
})

Deno.test('rejects a request without a valid JWT with 401', async () => {
  const res = await handler(new Request('http://localhost/', { method: 'POST' }))
  assertEquals(res.status, 401)
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd supabase/functions && deno test`
Expected: FAIL — `Module not found ".../handler.ts"`.

- [ ] **Step 3: Implement the function**

Create `supabase/functions/delete-account/handler.ts`:

```ts
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { requireUser } from '../_shared/auth.ts'
import { corsHeaders } from '../_shared/cors.ts'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })

/**
 * Deletes the CALLING user's auth account. The service-role client is created
 * only after the caller's JWT is verified, and only ever deletes the verified
 * caller's own id. Postgres `on delete cascade` (init.sql) removes the user's
 * tasks and settings rows.
 */
export async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const user = await requireUser(req)
  if (user instanceof Response) return user

  const admin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  )
  const { error } = await admin.auth.admin.deleteUser(user.id)
  if (error) return json({ error: 'Deletion failed' }, 500)
  return json({ ok: true })
}
```

Create `supabase/functions/delete-account/index.ts`:

```ts
import { handler } from './handler.ts'

Deno.serve(handler)
```

Append to `supabase/config.toml`:

```toml
[functions.delete-account]
verify_jwt = true
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd supabase/functions && deno test`
Expected: PASS (8 tests total across functions).

- [ ] **Step 5: Commit**

```bash
git checkout main && git pull --ff-only && git checkout -b feat/delete-account
git add supabase/functions/delete-account/ supabase/config.toml
git commit -m "Add the delete-account edge function"
```

### Task D2: Danger-zone settings section, test-first

**Files:**
- Create: `src/components/DangerZone.tsx`
- Test: `src/components/DangerZone.test.tsx`
- Modify: `src/pages/SettingsPage.tsx` (append to `SECTIONS`)
- Modify: `src/pages/Login.tsx` (goodbye notice)

**Interfaces:**
- Consumes: `SECTIONS` registry (Part B), `useAuth().signOut`, `supabase.functions.invoke`.
- Produces: `export function DangerZone()`; navigates to `/login` with `state: { accountDeleted: true }`, which Login renders as a green notice.

- [ ] **Step 1: Write the failing test**

Create `src/components/DangerZone.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
  invoke: vi.fn(() => Promise.resolve({ data: { ok: true }, error: null })),
  signOut: vi.fn(() => Promise.resolve()),
}))

vi.mock('../lib/supabase', () => ({
  supabase: { functions: { invoke: h.invoke } },
}))

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'u1' }, signOut: h.signOut }),
}))

import { DangerZone } from './DangerZone'

beforeEach(() => {
  h.invoke.mockClear()
  h.signOut.mockClear()
})

function renderZone() {
  return render(
    <MemoryRouter>
      <DangerZone />
    </MemoryRouter>,
  )
}

test('the delete button stays disabled until the user types delete', async () => {
  renderZone()
  const btn = screen.getByRole('button', { name: 'Delete my account' })
  expect(btn).toBeDisabled()
  await userEvent.type(screen.getByPlaceholderText('delete'), 'del')
  expect(btn).toBeDisabled()
  await userEvent.type(screen.getByPlaceholderText('delete'), 'ete')
  expect(btn).toBeEnabled()
})

test('confirming calls the delete-account function then signs out', async () => {
  renderZone()
  await userEvent.type(screen.getByPlaceholderText('delete'), 'delete')
  await userEvent.click(screen.getByRole('button', { name: 'Delete my account' }))
  expect(h.invoke).toHaveBeenCalledWith('delete-account', { method: 'POST' })
  expect(h.signOut).toHaveBeenCalled()
})

test('a failed call surfaces an error and does not sign out', async () => {
  h.invoke.mockResolvedValueOnce({ data: null, error: { message: 'boom' } })
  renderZone()
  await userEvent.type(screen.getByPlaceholderText('delete'), 'delete')
  await userEvent.click(screen.getByRole('button', { name: 'Delete my account' }))
  expect(await screen.findByText(/Could not delete your account/)).toBeInTheDocument()
  expect(h.signOut).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/components/DangerZone.test.tsx`
Expected: FAIL — cannot resolve `./DangerZone`.

- [ ] **Step 3: Implement `DangerZone`**

Create `src/components/DangerZone.tsx`:

```tsx
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'

/**
 * Irreversible account deletion. The typed confirmation is the friction that
 * guards it; the server function only ever deletes the verified caller.
 */
export function DangerZone() {
  const { signOut } = useAuth()
  const navigate = useNavigate()
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const armed = confirm.trim().toLowerCase() === 'delete'

  const deleteAccount = async () => {
    setBusy(true)
    setError(null)
    const { error: err } = await supabase.functions.invoke('delete-account', { method: 'POST' })
    if (err) {
      setError('Could not delete your account. Please try again or contact support.')
      setBusy(false)
      return
    }
    try {
      await signOut()
    } catch {
      // The server already invalidated the session; local sign-out noise is fine to ignore.
    }
    navigate('/login', { replace: true, state: { accountDeleted: true } })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 420 }}>
      <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5 }}>
        Permanently delete your account and all of your tasks and settings. This cannot be
        undone. Type <strong>delete</strong> to confirm.
      </p>
      <input
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        placeholder="delete"
        aria-label="Type delete to confirm"
        // ≥16px so iOS Safari doesn't zoom on focus.
        style={{ fontSize: 16, padding: '8px 10px', maxWidth: 240 }}
      />
      {error && <div style={{ color: '#b42318', fontSize: 13 }}>{error}</div>}
      <button
        type="button"
        disabled={!armed || busy}
        onClick={deleteAccount}
        style={{
          alignSelf: 'flex-start',
          padding: '10px 14px',
          borderRadius: 8,
          border: '1px solid #b42318',
          background: armed && !busy ? '#b42318' : 'transparent',
          color: armed && !busy ? '#fff' : '#b42318',
          fontWeight: 700,
          fontSize: 14,
          cursor: armed && !busy ? 'pointer' : 'default',
          opacity: busy ? 0.6 : 1,
        }}
      >
        {busy ? 'Deleting…' : 'Delete my account'}
      </button>
    </div>
  )
}
```

- [ ] **Step 4: Register the section and add the goodbye notice**

In `src/pages/SettingsPage.tsx`:

```tsx
import { DangerZone } from '../components/DangerZone'
```

and append to `SECTIONS`:

```tsx
  { id: 'danger', title: 'Danger zone', render: () => <DangerZone /> },
```

In `src/pages/Login.tsx`:

1. Change the router import to include `useLocation`:

```ts
import { Link, useLocation, useNavigate } from 'react-router-dom'
```

2. Inside `Login()`, read the flag:

```ts
  const location = useLocation()
  const accountDeleted = Boolean(
    (location.state as { accountDeleted?: boolean } | null)?.accountDeleted,
  )
```

3. Render it next to the existing notice block (immediately before `{error && …}` inside the form):

```tsx
          {accountDeleted && (
            <div style={{ color: '#86efac', fontSize: 13, lineHeight: 1.4 }}>
              Your account and all of its data have been deleted. Thanks for trying Magic Agenda.
            </div>
          )}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/components/DangerZone.test.tsx src/pages/SettingsPage.test.tsx src/pages/Login.test.tsx && npm test`
Expected: PASS. (`SettingsPage.test.tsx`'s supabase mock has no `functions` key — that's fine, `DangerZone` only touches it on click, which that test never does.)

- [ ] **Step 6: Commit**

```bash
git add src/components/DangerZone.tsx src/components/DangerZone.test.tsx src/pages/SettingsPage.tsx src/pages/Login.tsx
git commit -m "Add account deletion to settings behind a typed confirmation"
```

### Task D3: CHANGELOG + PR

- [ ] **Step 1: CHANGELOG entry** (under `### Added`)

```markdown
- **Delete account** — a Danger-zone section on `/settings` permanently deletes the account
  and all data (typed confirmation required). Deletion runs in a JWT-verified `delete-account`
  edge function; Postgres cascades remove the user's tasks and settings.
```

- [ ] **Step 2: Full verification**

Run: `npm test && npm run lint && npm run build && cd supabase/functions && deno test`
Expected: all PASS.

- [ ] **Step 3: Commit, push, PR**

```bash
git add CHANGELOG.md
git commit -m "Add delete-account changelog entry"
git push -u origin feat/delete-account
gh pr create --title "Delete account (roadmap 1.2)" --body "$(cat <<'EOF'
Self-service account deletion: Danger-zone section on /settings (type `delete` to confirm) calling a JWT-verified `delete-account` edge function that uses the service role only after verifying the caller, then deletes only the caller's own id. Cascades from init.sql remove tasks + settings. Login shows a goodbye notice.

## Post-merge verification
- [ ] `Deploy Functions` workflow succeeded
- [ ] With a throwaway account: delete it, confirm sign-in fails afterward and its rows are gone
EOF
)"
```

Wait for checks, merge, run the post-merge verification with a throwaway account.

---

# Part E — 1.3 Realtime multi-device sync (PR 5)

The riskiest item: a pure reducer (`src/data/realtime.ts`, test-first) applies remote `postgres_changes` events to `{ tasks, templates }`; `useTasks` wires a per-user channel with self-echo suppression, reconnect-with-backoff, and reload-on-wake; `useSettings` + `ThemeProvider` make theme/default-view changes propagate live.

**Known caveats (documented, accepted):**
- DELETE events carry only the primary key (replica identity), so the `user_id=eq.` filter can't apply to them — other rows' delete events may arrive and must no-op (the reducer drops unknown ids). Leaked information is limited to opaque UUIDs.
- Last-write-wins on concurrent edits of the same task (single-user boards; acceptable).
- A template INSERT from another device does **not** trigger local materialization — the originating device materializes, and instances arrive as their own events (next `reload()` is the backstop).

### Task E1: Publication migration

**Files:**
- Create: `supabase/migrations/20260704090000_realtime_tasks.sql`

- [ ] **Step 1: Create the migration**

```sql
-- Realtime: stream per-user task and settings changes to signed-in clients.
-- postgres_changes respects RLS for INSERT/UPDATE (subscribers only receive rows
-- their policies allow). DELETE events carry only the primary key and are not
-- filterable — the client reducer treats unknown ids as no-ops.
alter publication supabase_realtime add table public.tasks, public.user_settings;
```

No type regeneration: the publication change doesn't alter any table shape.

- [ ] **Step 2: Commit**

```bash
git checkout main && git pull --ff-only && git checkout -b feat/realtime-sync
git add supabase/migrations/20260704090000_realtime_tasks.sql
git commit -m "Publish tasks and user_settings on the realtime publication"
```

### Task E2: Pure reducer `applyTaskChange` + `payloadToChange`, test-first

**Files:**
- Create: `src/data/realtime.ts`
- Test: `src/data/realtime.test.ts`

**Interfaces:**
- Consumes: `rowToTask` (mappers), `instanceOrigin` (recurrence), `isTemplate`/`Task`/`NO_RECUR` (types), `Database` row types.
- Produces:

```ts
export interface BoardState { tasks: Task[]; templates: Task[] }
export type TaskChange =
  | { type: 'INSERT'; task: Task }
  | { type: 'UPDATE'; task: Task }
  | { type: 'DELETE'; id: string }
export function payloadToChange(p: RealtimePostgresChangesPayload<TaskRow>): TaskChange | null
export function applyTaskChange(state: BoardState, change: TaskChange): BoardState
// Contract: returns the SAME state object (referential identity) when the change is a no-op.
```

- [ ] **Step 1: Write the failing tests**

Create `src/data/realtime.test.ts`:

```ts
import { expect, test } from 'vitest'
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js'
import { NO_RECUR, type Task } from '../types/task'
import type { Database } from '../types/database.types'
import { applyTaskChange, payloadToChange, type BoardState } from './realtime'

type TaskRow = Database['public']['Tables']['tasks']['Row']

const base: Task = {
  id: 't1',
  title: 'A',
  description: '',
  category: 'work',
  color: 'yellow',
  checklist: [],
  status: 'todo',
  done: false,
  day: '2026-07-01',
  order: 0,
  korder: 0,
  ...NO_RECUR,
}
const mk = (over: Partial<Task>): Task => ({ ...base, ...over })

const row = (over: Partial<TaskRow> = {}): TaskRow =>
  ({
    id: 't1',
    user_id: 'u1',
    title: 'A',
    description: '',
    category: 'work',
    color: 'yellow',
    checklist: [],
    status: 'todo',
    day: '2026-07-01',
    order_index: 0,
    korder: 0,
    recur_freq: 'none',
    recur_interval: 1,
    recur_until: null,
    recur_parent_id: null,
    recur_skip: [],
    recur_origin_day: null,
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
    ...over,
  }) as TaskRow

const state = (tasks: Task[] = [], templates: Task[] = []): BoardState => ({ tasks, templates })

// ---- payloadToChange ----

test('maps INSERT and UPDATE payloads through rowToTask', () => {
  const p = { eventType: 'INSERT', new: row({ title: 'X', day: null }), old: {} }
  const change = payloadToChange(p as unknown as RealtimePostgresChangesPayload<TaskRow>)
  expect(change).toMatchObject({ type: 'INSERT', task: { title: 'X', day: 'inbox' } })
})

test('maps DELETE payloads to the old id, or null when the id is missing', () => {
  const del = { eventType: 'DELETE', new: {}, old: { id: 't9' } }
  expect(payloadToChange(del as unknown as RealtimePostgresChangesPayload<TaskRow>)).toEqual({
    type: 'DELETE',
    id: 't9',
  })
  const bad = { eventType: 'DELETE', new: {}, old: {} }
  expect(payloadToChange(bad as unknown as RealtimePostgresChangesPayload<TaskRow>)).toBeNull()
})

// ---- applyTaskChange: plain tasks ----

test('INSERT appends a new task', () => {
  const next = applyTaskChange(state([mk({ id: 't1' })]), {
    type: 'INSERT',
    task: mk({ id: 't2', title: 'B' }),
  })
  expect(next.tasks.map((t) => t.id)).toEqual(['t1', 't2'])
})

test('UPDATE replaces the matching task', () => {
  const next = applyTaskChange(state([mk({ id: 't1', title: 'old' })]), {
    type: 'UPDATE',
    task: mk({ id: 't1', title: 'new' }),
  })
  expect(next.tasks[0].title).toBe('new')
})

test('UPDATE for an unknown id inserts it (missed event tolerance)', () => {
  const next = applyTaskChange(state([]), { type: 'UPDATE', task: mk({ id: 't1' }) })
  expect(next.tasks).toHaveLength(1)
})

test('a no-op UPDATE returns the same state object', () => {
  const s = state([mk({ id: 't1' })])
  expect(applyTaskChange(s, { type: 'UPDATE', task: mk({ id: 't1' }) })).toBe(s)
})

test('DELETE removes the task; unknown ids are a referential no-op', () => {
  const s = state([mk({ id: 't1' })])
  expect(applyTaskChange(s, { type: 'DELETE', id: 't1' }).tasks).toHaveLength(0)
  expect(applyTaskChange(s, { type: 'DELETE', id: 'nope' })).toBe(s)
})

// ---- applyTaskChange: templates ----

const template = mk({ id: 'tpl1', recurFreq: 'daily', recurParentId: null })

test('template INSERT/UPDATE goes to templates, never the board', () => {
  const next = applyTaskChange(state([], []), { type: 'INSERT', task: template })
  expect(next.templates.map((t) => t.id)).toEqual(['tpl1'])
  expect(next.tasks).toHaveLength(0)
})

test('a template update leaves the board tasks array untouched (same reference)', () => {
  const s = state([mk({ id: 't1' })], [template])
  const next = applyTaskChange(s, {
    type: 'UPDATE',
    task: { ...template, title: 'renamed' },
  })
  expect(next.templates[0].title).toBe('renamed')
  expect(next.tasks).toBe(s.tasks)
})

test('a task promoted to a template moves out of the board list', () => {
  const s = state([mk({ id: 't1' })], [])
  const next = applyTaskChange(s, {
    type: 'UPDATE',
    task: mk({ id: 't1', recurFreq: 'weekly' }),
  })
  expect(next.tasks).toHaveLength(0)
  expect(next.templates.map((t) => t.id)).toEqual(['t1'])
})

test('a template demoted to a plain task moves back to the board', () => {
  const s = state([], [template])
  const next = applyTaskChange(s, {
    type: 'UPDATE',
    task: mk({ id: 'tpl1', recurFreq: 'none' }),
  })
  expect(next.templates).toHaveLength(0)
  expect(next.tasks.map((t) => t.id)).toEqual(['tpl1'])
})

test('deleting a template drops it and all of its local instances', () => {
  const inst = mk({ id: 'i1', recurParentId: 'tpl1', recurOriginDay: '2026-07-02' })
  const next = applyTaskChange(state([inst, mk({ id: 't1' })], [template]), {
    type: 'DELETE',
    id: 'tpl1',
  })
  expect(next.templates).toHaveLength(0)
  expect(next.tasks.map((t) => t.id)).toEqual(['t1'])
})

// ---- applyTaskChange: instance dedupe ----

test('an instance INSERT for an occurrence we already cover replaces the local twin', () => {
  const local = mk({ id: 'local', recurParentId: 'tpl1', recurOriginDay: '2026-07-02' })
  const remote = mk({ id: 'remote', recurParentId: 'tpl1', recurOriginDay: '2026-07-02' })
  const next = applyTaskChange(state([local]), { type: 'INSERT', task: remote })
  expect(next.tasks.map((t) => t.id)).toEqual(['remote'])
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/data/realtime.test.ts`
Expected: FAIL — cannot resolve `./realtime`.

- [ ] **Step 3: Implement `src/data/realtime.ts`**

```ts
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js'
import { isTemplate, type Task } from '../types/task'
import { instanceOrigin } from './recurrence'
import { rowToTask } from './mappers'
import type { Database } from '../types/database.types'

type TaskRow = Database['public']['Tables']['tasks']['Row']

export interface BoardState {
  /** Board tasks (non-recurring + materialized instances). */
  tasks: Task[]
  /** Hidden recurrence templates (the useTasks templatesRef contents). */
  templates: Task[]
}

export type TaskChange =
  | { type: 'INSERT'; task: Task }
  | { type: 'UPDATE'; task: Task }
  | { type: 'DELETE'; id: string }

/** Normalize a realtime payload into a TaskChange, or null for unusable payloads. */
export function payloadToChange(p: RealtimePostgresChangesPayload<TaskRow>): TaskChange | null {
  if (p.eventType === 'DELETE') {
    // DELETE events carry only the replica identity (the primary key).
    const id = (p.old as Partial<TaskRow>).id
    return id ? { type: 'DELETE', id } : null
  }
  if (p.eventType === 'INSERT' || p.eventType === 'UPDATE') {
    return { type: p.eventType, task: rowToTask(p.new as TaskRow) }
  }
  return null
}

const sameTask = (a: Task, b: Task) => JSON.stringify(a) === JSON.stringify(b)

/** The occurrence an instance covers — mirrors the (recur_parent_id, recur_origin_day) index. */
const instanceKey = (t: Task) => `${t.recurParentId}|${instanceOrigin(t)}`

/**
 * Apply one remote change to local board state. Pure. Returns the SAME state
 * object when the change is a no-op so callers can cheaply skip re-renders
 * (DELETE events for other users' rows arrive unfiltered and must cost nothing).
 */
export function applyTaskChange(state: BoardState, change: TaskChange): BoardState {
  if (change.type === 'DELETE') {
    if (state.templates.some((t) => t.id === change.id)) {
      // Template deletes cascade to instances server-side; drop them locally now —
      // the instances' own DELETE echoes then no-op here.
      return {
        tasks: state.tasks.filter((t) => t.recurParentId !== change.id),
        templates: state.templates.filter((t) => t.id !== change.id),
      }
    }
    if (!state.tasks.some((t) => t.id === change.id)) return state
    return { ...state, tasks: state.tasks.filter((t) => t.id !== change.id) }
  }

  const task = change.task

  if (isTemplate(task)) {
    // A template row never renders on the board; a task edited into a series
    // also moves out of the board list (mirrors the useTasks updateTask branch).
    const existing = state.templates.find((t) => t.id === task.id)
    const wasBoardTask = state.tasks.some((t) => t.id === task.id)
    if (existing && !wasBoardTask && sameTask(existing, task)) return state
    return {
      tasks: wasBoardTask ? state.tasks.filter((t) => t.id !== task.id) : state.tasks,
      templates: existing
        ? state.templates.map((t) => (t.id === task.id ? task : t))
        : [...state.templates, task],
    }
  }

  const wasTemplate = state.templates.some((t) => t.id === task.id)
  const templates = wasTemplate ? state.templates.filter((t) => t.id !== task.id) : state.templates

  const existing = state.tasks.find((t) => t.id === task.id)
  if (existing) {
    if (!wasTemplate && sameTask(existing, task)) return state
    return { templates, tasks: state.tasks.map((t) => (t.id === task.id ? task : t)) }
  }

  // New row. Another device may have materialized the same occurrence we hold
  // locally under a different id — the committed event wins (the unique index
  // rejects the loser server-side).
  if (task.recurParentId) {
    const key = instanceKey(task)
    const dupe = state.tasks.find((t) => t.recurParentId && instanceKey(t) === key)
    if (dupe) {
      return { templates, tasks: state.tasks.map((t) => (t.id === dupe.id ? task : t)) }
    }
  }
  return { templates, tasks: [...state.tasks, task] }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/data/realtime.test.ts`
Expected: PASS — all 14 tests.

- [ ] **Step 5: Commit**

```bash
git add src/data/realtime.ts src/data/realtime.test.ts
git commit -m "Add the pure realtime change reducer"
```

### Task E3: Wire the channel into `useTasks` with self-echo suppression

**Files:**
- Modify: `src/data/useTasks.ts`
- Test: `src/data/useTasks.test.ts` (new)

**Interfaces:**
- Consumes: `applyTaskChange`, `payloadToChange` (E2).
- Produces: no public API change to `UseTasks`. Internals: `ownWrites: Map<id, expiryMs>` with a 5s TTL; `markWrites(ids)` called by **every** mutation before its Supabase call; a `postgres_changes` subscription effect; reconnect with exponential backoff; `reload()` on `visibilitychange`→visible and `online`.

- [ ] **Step 1: Write the failing test**

Create `src/data/useTasks.test.ts`:

```ts
import { renderHook, act, waitFor } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import { NO_RECUR, type Task } from '../types/task'

const h = vi.hoisted(() => {
  const capture: { handler: ((p: unknown) => void) | null; rows: unknown[] } = {
    handler: null,
    rows: [],
  }
  const ok = () => Promise.resolve({ data: null, error: null })
  const channel: Record<string, unknown> = {}
  channel.on = vi.fn((_e: string, _f: unknown, cb: (p: unknown) => void) => {
    capture.handler = cb
    return channel
  })
  channel.subscribe = vi.fn((cb?: (s: string) => void) => {
    cb?.('SUBSCRIBED')
    return channel
  })
  return { capture, ok, channel }
})

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => Promise.resolve({ data: h.capture.rows, error: null })),
      insert: vi.fn(h.ok),
      upsert: vi.fn(h.ok),
      update: vi.fn(() => ({ eq: vi.fn(h.ok) })),
      delete: vi.fn(() => ({
        eq: vi.fn(h.ok),
        gt: vi.fn(h.ok),
        gte: vi.fn(h.ok),
      })),
    })),
    channel: vi.fn(() => h.channel),
    removeChannel: vi.fn(),
  },
}))

import { useTasks } from './useTasks'

const serverRow = (over: Record<string, unknown> = {}) => ({
  id: 't1',
  user_id: 'u1',
  title: 'server',
  description: '',
  category: 'work',
  color: 'yellow',
  checklist: [],
  status: 'todo',
  day: '2026-07-01',
  order_index: 0,
  korder: 0,
  recur_freq: 'none',
  recur_interval: 1,
  recur_until: null,
  recur_parent_id: null,
  recur_skip: [],
  recur_origin_day: null,
  created_at: '',
  updated_at: '',
  ...over,
})

const appTask = (over: Partial<Task>): Task => ({
  id: 't1',
  title: 'server',
  description: '',
  category: 'work',
  color: 'yellow',
  checklist: [],
  status: 'todo',
  done: false,
  day: '2026-07-01',
  order: 0,
  korder: 0,
  ...NO_RECUR,
  ...over,
})

beforeEach(() => {
  h.capture.handler = null
  h.capture.rows = [serverRow()]
})

test('a stale echo of our own write does not clobber optimistic state', async () => {
  const { result } = renderHook(() => useTasks('u1'))
  await waitFor(() => expect(result.current.loading).toBe(false))

  await act(async () => {
    await result.current.updateTask(appTask({ title: 'local edit' }))
  })
  expect(result.current.tasks[0].title).toBe('local edit')

  // The write's own change event arrives back — carrying the pre-edit row.
  act(() => {
    h.capture.handler!({
      eventType: 'UPDATE',
      new: serverRow({ title: 'stale echo' }),
      old: { id: 't1' },
    })
  })
  expect(result.current.tasks[0].title).toBe('local edit')
})

test('a change from another device is applied', async () => {
  const { result } = renderHook(() => useTasks('u1'))
  await waitFor(() => expect(result.current.loading).toBe(false))

  act(() => {
    h.capture.handler!({
      eventType: 'INSERT',
      new: serverRow({ id: 't2', title: 'from the phone' }),
      old: {},
    })
  })
  expect(result.current.tasks.map((t) => t.id)).toEqual(['t1', 't2'])
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/data/useTasks.test.ts`
Expected: the first test FAILS (no subscription exists yet — `h.capture.handler` is null, TypeError).

- [ ] **Step 3: Implement the wiring in `src/data/useTasks.ts`**

1. Extend imports:

```ts
import { applyTaskChange, payloadToChange } from './realtime'
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js'
import type { Database } from '../types/database.types'

type TaskRow = Database['public']['Tables']['tasks']['Row']
```

2. Inside `useTasks`, after the `inFlight` ref, add the own-write tracking:

```ts
  // Ids this client just wrote, with expiry. Realtime echoes of our own writes are
  // skipped so they can't clobber newer optimistic state (e.g. during rapid drags).
  const ownWrites = useRef(new Map<string, number>())
  const OWN_WRITE_TTL_MS = 5000

  const markWrites = useCallback((ids: readonly (string | null | undefined)[]) => {
    const now = Date.now()
    for (const [id, exp] of ownWrites.current) if (exp < now) ownWrites.current.delete(id)
    for (const id of ids) if (id) ownWrites.current.set(id, now + OWN_WRITE_TTL_MS)
  }, [])

  const isOwnWrite = useCallback((id: string) => {
    const exp = ownWrites.current.get(id)
    return exp !== undefined && exp > Date.now()
  }, [])
```

3. Add `markWrites(...)` to every mutation, immediately before its Supabase call:

- `materialize`: `markWrites(instances.map((i) => i.id))` (before the `insert`).
- `createTask`: template branch `markWrites([task.id])`; normal branch `markWrites([full.id])`.
- `updateTask`: `markWrites([task.id])` in both branches.
- `removeTask`: `markWrites([id])`.
- `toggleDone`: `markWrites([id])`.
- `persistReorder`: `markWrites(rows.map((r) => r.id))`.
- `updateSeries`: after building `rows`: `markWrites(rows.map((r) => r.id))`; and in the shortened-rule branch, before the delete call:

```ts
        markWrites(
          tasksRef.current
            .filter((t) => t.recurParentId === template.id && instanceOrigin(t) > until)
            .map((t) => t.id),
        )
```

  (place this line ABOVE the `setTasks` filter in that branch so the ids are still present in `tasksRef`).
- `deleteOccurrence`: `markWrites([template?.id, instance.id])` (top of function; `template` may be undefined — `markWrites` skips nullish).

  Note: `deleteOccurrence` currently destructures `template` inside an `if (template)` block — hoist the lookup above the mark call, i.e. keep `const template = templatesRef.current.find(…)` first, then `markWrites([template?.id, instance.id])`, then the existing `if (template) { … }`.
- `deleteSeriesFuture`: after `const cut = instanceOrigin(instance)`, add:

```ts
      markWrites([
        template.id,
        ...tasksRef.current
          .filter((t) => t.recurParentId === template.id && isFromOccurrenceOnward(t, cut))
          .map((t) => t.id),
      ])
```

  and in the whole-series branch (before its `setTasks`):

```ts
        markWrites([
          template.id,
          ...tasksRef.current.filter((t) => t.recurParentId === template.id).map((t) => t.id),
        ])
```

  Also add `markWrites([instance.id])` before the early `removeTask(instance.id)` return (no template found) — actually unnecessary: `removeTask` already marks. Skip it.

4. Add the subscription effect (after the `useEffect` that calls `reload`):

```ts
  // Live changes from other devices/sessions. Sub-epoch bumps force a fresh
  // channel after an error (with backoff); reload() covers anything missed.
  const [subEpoch, setSubEpoch] = useState(0)
  const retries = useRef(0)

  useEffect(() => {
    if (!userId) return
    let disposed = false
    const channel = supabase
      .channel(`tasks-${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tasks', filter: `user_id=eq.${userId}` },
        (payload) => {
          const change = payloadToChange(payload as RealtimePostgresChangesPayload<TaskRow>)
          if (!change) return
          const id = change.type === 'DELETE' ? change.id : change.task.id
          if (isOwnWrite(id)) return
          const prev = { tasks: tasksRef.current, templates: templatesRef.current }
          const next = applyTaskChange(prev, change)
          if (next === prev) return
          templatesRef.current = next.templates
          if (next.tasks !== prev.tasks) setTasks(next.tasks)
        },
      )
      .subscribe((status) => {
        if (disposed) return
        if (status === 'SUBSCRIBED') {
          retries.current = 0
          return
        }
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          const backoff = Math.min(30_000, 1000 * 2 ** retries.current++)
          void reload()
          window.setTimeout(() => {
            if (!disposed) setSubEpoch((e) => e + 1)
          }, backoff)
        }
      })
    return () => {
      disposed = true
      void supabase.removeChannel(channel)
    }
  }, [userId, subEpoch, isOwnWrite, reload, setTasks])
```

5. Add the wake/online effect (mobile Safari kills sockets aggressively):

```ts
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void reload()
    }
    const onOnline = () => void reload()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onOnline)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onOnline)
    }
  }, [reload])
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/data/useTasks.test.ts && npm test`
Expected: PASS — both new tests, and every existing suite.

- [ ] **Step 5: Commit**

```bash
git add src/data/useTasks.ts src/data/useTasks.test.ts
git commit -m "Stream task changes into useTasks with self-echo suppression"
```

### Task E4: Live settings sync (`useSettings` + `ThemeProvider`)

**Files:**
- Modify: `src/data/useSettings.ts`
- Modify: `src/theme/ThemeProvider.tsx`
- Test: `src/data/useSettings.test.ts` (extend), `src/theme/ThemeProvider.test.tsx` (new)

**Interfaces:**
- Produces: `useSettings` applies remote `user_settings` changes to its state (3-second suppression window after any local persist); `ThemeProvider` re-syncs its internal theme when the `initial` prop changes (that's what restyles device B).

- [ ] **Step 1: Write the failing tests**

Create `src/theme/ThemeProvider.test.tsx`:

```tsx
import { renderHook } from '@testing-library/react'
import { expect, test } from 'vitest'
import type { ReactNode } from 'react'
import type { ThemeName } from '../types/task'
import { ThemeProvider, useTheme } from './ThemeProvider'

test('re-syncs when the persisted theme changes elsewhere (initial prop updates)', () => {
  const { result, rerender } = renderHook(() => useTheme(), {
    wrapper: ({ children, ...p }: { children: ReactNode; theme?: ThemeName }) => (
      <ThemeProvider initial={(p as { theme?: ThemeName }).theme ?? 'cork'}>
        {children}
      </ThemeProvider>
    ),
    initialProps: { theme: 'cork' as ThemeName },
  })
  expect(result.current.theme).toBe('cork')
  rerender({ theme: 'brutal' as ThemeName })
  expect(result.current.theme).toBe('brutal')
})
```

In `src/data/useSettings.test.ts`, extend the hoisted mock and add a test. Replace the `vi.mock` block with:

```ts
const h = vi.hoisted(() => {
  const upsertThen = vi.fn()
  const upsert = vi.fn(() => ({
    then: (onFulfilled: (r: { data: null; error: null }) => unknown) => {
      upsertThen()
      return Promise.resolve({ data: null, error: null }).then(onFulfilled)
    },
  }))
  const maybeSingle = vi.fn(() =>
    Promise.resolve({ data: { theme: 'cork', default_view: 'calendar' }, error: null }),
  )
  const capture: { handler: ((p: unknown) => void) | null } = { handler: null }
  const channel: Record<string, unknown> = {}
  channel.on = vi.fn((_e: string, _f: unknown, cb: (p: unknown) => void) => {
    capture.handler = cb
    return channel
  })
  channel.subscribe = vi.fn(() => channel)
  return { upsertThen, upsert, maybeSingle, capture, channel }
})

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: h.maybeSingle })) })),
      upsert: h.upsert,
    })),
    channel: vi.fn(() => h.channel),
    removeChannel: vi.fn(),
  },
}))
```

and append the new test:

```ts
test('a settings change from another device is applied', async () => {
  const { result } = renderHook(() => useSettings('user-1'))
  await waitFor(() => expect(result.current.loading).toBe(false))

  act(() => {
    h.capture.handler!({
      eventType: 'UPDATE',
      new: { user_id: 'user-1', theme: 'glass', default_view: 'week' },
      old: {},
    })
  })
  expect(result.current.settings).toEqual({ theme: 'glass', defaultView: 'week' })
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/theme/ThemeProvider.test.tsx src/data/useSettings.test.ts`
Expected: both new tests FAIL (theme stays `cork`; `h.capture.handler` is null).

- [ ] **Step 3: Implement**

In `src/theme/ThemeProvider.tsx`, add `useEffect` to the react import and add inside `ThemeProvider` (after the `useState`):

```ts
  // Re-sync when the persisted theme changes elsewhere (another device via realtime).
  // Local changes are unaffected: they flow through setTheme and land back here as
  // the same value, which React bails out on.
  useEffect(() => {
    setThemeState(initial)
  }, [initial])
```

In `src/data/useSettings.ts`:

1. Extend the react import with `useEffect` (already there) — add a `lastLocalWrite` ref and stamp it in `persist`:

```ts
  const lastLocalWrite = useRef(0)
```

and as the first line of `persist`:

```ts
      lastLocalWrite.current = Date.now()
```

2. Add the subscription effect after the load effect:

```ts
  // Live settings changes from other devices. Skip events shortly after a local
  // persist — the echo of our own upsert could otherwise transiently revert a
  // rapid second change.
  useEffect(() => {
    if (!userId) return
    const channel = supabase
      .channel(`settings-${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'user_settings', filter: `user_id=eq.${userId}` },
        (payload) => {
          if (Date.now() - lastLocalWrite.current < 3000) return
          const row = payload.new as { theme?: string; default_view?: string } | null
          if (!row?.theme || !row.default_view) return
          const next: Settings = {
            theme: row.theme as ThemeName,
            defaultView: row.default_view as ViewName,
          }
          if (next.theme === ref.current.theme && next.defaultView === ref.current.defaultView)
            return
          ref.current = next
          setSettings(next)
        },
      )
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [userId])
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/theme/ThemeProvider.test.tsx src/data/useSettings.test.ts src/pages/SettingsPage.test.tsx && npm test`
Expected: PASS. **If `SettingsPage.test.tsx` fails** with `supabase.channel is not a function`: its mock now also needs `channel`/`removeChannel` — add the same `channel`/`removeChannel` mock entries there.

- [ ] **Step 5: Commit**

```bash
git add src/data/useSettings.ts src/data/useSettings.test.ts src/theme/ThemeProvider.tsx src/theme/ThemeProvider.test.tsx src/pages/SettingsPage.test.tsx
git commit -m "Sync settings and theme live across devices"
```

### Task E5: Docs, CHANGELOG, two-device verification, PR

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `CLAUDE.md` (architecture section)

- [ ] **Step 1: CHANGELOG entry** (under `### Added`)

```markdown
- **Realtime multi-device sync** — edits, drags, and deletions now appear live on every
  signed-in device via Supabase realtime (`postgres_changes` under RLS). A pure reducer
  (`src/data/realtime.ts`) applies remote changes — deduping recurring instances by
  occurrence, keeping templates off the board — while echoes of the device's own writes
  are suppressed. The board also refetches on reconnect, on coming back online, and when
  the tab becomes visible again (fixes stale boards on phones). Theme and default-view
  changes propagate live too.
```

- [ ] **Step 2: Update CLAUDE.md**

In the `### Data ownership` paragraph of `CLAUDE.md`, append after the last sentence:

```markdown
`useTasks` and `useSettings` also subscribe to Supabase realtime (`postgres_changes`,
per-user channel): remote changes flow through the pure reducer in `src/data/realtime.ts`
(instance dedupe by `(recurParentId, recurOriginDay)`, templates routed to `templatesRef`),
while a short-TTL own-write set suppresses each client's own echoes. On channel error the
hook reloads and resubscribes with backoff; `visibilitychange`/`online` also trigger a
`reload()`.
```

- [ ] **Step 3: Full verification**

Run: `npm test && npm run lint && npm run build`
Expected: all PASS.

Manual two-device test (after the PR's preview or against production post-merge — the publication migration only exists in production once merged; for pre-merge testing run `npx supabase db push` against a branch/local DB per CLAUDE.md):

1. Open the board in two browser windows (same account).
2. Create, edit, drag, complete, and delete a task in window A → each appears in window B within ~1s without refresh.
3. Create a recurring series in A → template's instances appear in B; delete one occurrence in A → it disappears in B and stays gone after B reloads.
4. Change the theme in A → B restyles.
5. Put B's tab in the background for 2+ minutes, make changes in A, foreground B → B catches up (reload-on-visible).

- [ ] **Step 4: Commit, push, PR**

```bash
git add CHANGELOG.md CLAUDE.md
git commit -m "Document realtime sync"
git push -u origin feat/realtime-sync
gh pr create --title "Realtime multi-device sync (roadmap 1.3)" --body "$(cat <<'EOF'
Live sync via Supabase postgres_changes under RLS: pure reducer (test-first) + per-user channel in useTasks/useSettings, self-echo suppression, reconnect with backoff, reload on visibility/online. Publication migration auto-applies on merge.

Known accepted caveats (documented in the reducer):
- DELETE events carry only the PK and aren't filterable; unknown ids no-op.
- Last-write-wins on concurrent edits (single-user boards).

## Post-merge verification
- [ ] Two-window live-sync test (create/edit/drag/delete/recurrence/theme)
- [ ] Mobile: background the PWA tab, edit on desktop, foreground → catches up
EOF
)"
```

Wait for checks, merge, run the post-merge verification.

---

## Self-review checklist (for the plan author, completed)

- Spec coverage: 0.1 → Part A; 0.2 → Part B (incl. the 5.3 settings-footer half); 1.1 → Part C; 1.2 → Part D; 1.3 → Part E (incl. `useSettings` + ThemeProvider live-theme requirement). Manual production steps are embedded in each PR body.
- Type consistency: `requireUser(req): Promise<User | Response>` used identically in A and D; `SECTIONS`/`SectionContext` defined in B, consumed in D; `passwordRecovery`/`clearPasswordRecovery` defined in C1, consumed in C3; `BoardState`/`TaskChange`/`payloadToChange`/`applyTaskChange` defined in E2, consumed in E3.
- Known risk callouts: Node-tooling excludes (A3), `SettingsPage.test.tsx` channel-mock breakage (E4 Step 4), `App.test.tsx` stability under the Login rework (C2 Step 5).
