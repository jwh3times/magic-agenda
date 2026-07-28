# Installable PWA + Offline Read — Design

- **Date:** 2026-07-27
- **Status:** Approved, not yet implemented
- **Delivers:** ROADMAP 3.1 (installable PWA + offline read) in one PR. Unblocks 3.2 (reminders),
  which needs the app installed to Home Screen before iOS will deliver web push.

## Problem

Magic Agenda is phone-first — mobile layouts, touch drag with a 250ms long-press, `100dvh` shell —
but it is not installable and it does not survive losing the network. There is no manifest and no
service worker: `public/` holds `favicon.svg`, `apple-touch-icon.png`, `og.png`, `robots.txt`,
`_headers`, and `_redirects`, and nothing else.

Opening the app without a connection today gives you nothing. `reload()`'s query resolves with an
error, `tasks` stays empty, and `BoardPage` renders `ErrorScreen` with a Retry button that cannot
succeed. Meanwhile the theme resets (see "The prerequisite defect" below). A user on a plane has a
board full of tasks on their device and no way to see any of them.

Two goals, weighted equally: a real home-screen install, and a board that still shows your tasks
with no network.

## Decisions

| Question                                         | Decision                                                                      | Why                                                                                                                                             |
| ------------------------------------------------ | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| How much of the worker do we own?                | `vite-plugin-pwa` in **`injectManifest`** mode; we author `src/sw.ts`         | The plugin does the revisioned precache list and build wiring; the caching policy — the part that bricks an app when wrong — stays readable     |
| Does the shipped worker contain workbox code?    | No. `src/sw.ts` imports no workbox runtime helpers, only `self.__WB_MANIFEST` | Keeps the dependency dev-only and the deployed artifact entirely ours                                                                           |
| How are navigations served?                      | **Network-first**, cache fallback                                             | The one safety property that matters: an online user always gets the newest `index.html`, so a bad deploy stays fixable by merging              |
| How are hashed assets served?                    | Cache-first                                                                   | Vite emits content-hashed filenames, so they are immutable by construction                                                                      |
| Where does the "never cache Supabase" rule live? | A tested predicate in `src/sw/policy.ts`, not a comment                       | The rule most likely to be broken by a well-meaning future edit; as a test it fails CI instead of leaking a board into a shared cache           |
| Who registers the worker?                        | `src/lib/registerSW.ts`, called from `main.tsx`; plugin auto-registration off | The plugin's default injects an **inline** script, which `script-src 'self'` blocks. Also keeps the update wiring visible                       |
| Where does the offline snapshot live?            | `localStorage`: two versioned envelopes keyed to the user id, one per writer  | Matches `viewStorage.ts`; sync read on boot with no async hydration step; a task board's rows are far below the 5 MB cap                        |
| Offline with an expired token — render or not?   | **Render** the snapshot read-only                                             | Refusing protects nothing: anyone who can open the app can open devtools and read the same `localStorage`. Writes are impossible offline anyway |
| When is the snapshot cleared?                    | On sign-out and on account deletion                                           | The mitigation that makes storing task text at rest defensible — it exists only while someone is signed in on the device                        |
| How is drag disabled offline?                    | Reuse the existing `DragDisabledContext`                                      | Already consumed by `SortableCard`'s `useSortable({ disabled })`; no sensor changes, so the constant-size sensors array stays constant          |
| Offline write queue?                             | **Out of scope**                                                              | The roadmap scopes it out explicitly; a reconciler against optimistic CRUD plus realtime plus recurrence is its own XL item                     |

## The prerequisite defect

`src/data/useSettings.ts:43` destructures only `data` and never looks at `error`:

```ts
.then(({ data }) => {
  const next: Settings = data
    ? { theme: data.theme as ThemeName, defaultView: data.default_view as ViewName }
    : DEFAULTS
  ref.current = next
  setSettings(next)
  setLoading(false)
})
```

A failed request and "this user has no row yet" are therefore the same branch. `postgrest-js`
catches fetch failures and resolves with `{ data: null, error }` unless `.throwOnError()` is used —
which this call does not — so offline, `data` is `null`, `next` becomes `DEFAULTS`, and a `glass`
user with a `kanban` default view is silently reset to `cork`/`calendar`. Nothing hangs and nothing
rejects; the settings just quietly revert on every failed load, offline or not.

This is fixed as part of this work rather than alongside it, because an offline board that renders
in the wrong theme is a worse first impression than no offline board at all. The fix reads `error`,
falls back to the settings snapshot when the request failed, and reaches `DEFAULTS` only for a
genuine `data === null` **with no error** — the real "no row yet" case that the signup trigger
normally prevents.

The same conflation exists in `reload()` (`useTasks.ts:159`), which is where offline hydration hooks
in: an offline load takes the existing `if (err)` branch, not a `catch`. A `catch` is still added
around the query, because `throwOnError` is a one-line change away and a future edit that adds it
must not turn an offline boot into an unhandled rejection.

## Architecture

Six units, each testable on its own. None of this goes inside `useTasks.ts`, which is already 623
lines.

| Unit                    | Responsibility                                                                                                                                                             |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/sw.ts`             | The worker. Precache `self.__WB_MANIFEST` on install, route fetches by policy, delete stale cache versions on activate, handle a `SKIP_WAITING` message.                   |
| `src/sw/policy.ts`      | Pure predicates: `isCacheFirst(url)`, `isNeverCached(url)`, `isNavigation(request)`. No worker globals, so vitest can exercise them.                                       |
| `src/lib/registerSW.ts` | Registration (StrictMode-safe), `onUpdateReady(cb)`, `applyUpdate()`. No React.                                                                                            |
| `src/data/snapshot.ts`  | Versioned read/write of the board and settings envelopes, plus `clearSnapshots()`. Validates on read, drops on mismatch, swallows every storage error.                     |
| `src/lib/useOnline.ts`  | Reactive connectivity, shaped like `useMediaQuery.ts`. Returns **online** where `navigator.onLine` is unavailable, so jsdom tests get today's behavior unless they opt in. |
| `ReadOnlyContext`       | One boolean, provided by `BoardPage`, consumed by `Board` and `TaskEditor`.                                                                                                |

### Caching policy

```
navigation request        -> network-first, fall back to cached /index.html
same-origin hashed asset  -> cache-first
Google Fonts (css + woff) -> cache-first, runtime cache
*.supabase.co (any)       -> never touched by the worker; falls through to network
everything else           -> network, no caching
```

`isNeverCached` matches `*.supabase.co` over both `https:` and `wss:`. Its test is the load-bearing
one in this feature: auth-scoped rows in a cache shared by every profile on the device is the exact
footgun the roadmap names.

### Content Security Policy

`public/_headers` applies its `/*` rule to every path, `/sw.js` included. A font fetch issued from
inside the worker is governed by the **worker's** `connect-src`, which today is
`'self' https://*.supabase.co wss://*.supabase.co` — so runtime-caching Google Fonts fails as the
roadmap sketches it.

Fix: add a `/sw.js` block to `_headers` that overrides `connect-src` for that path alone, adding
`https://fonts.googleapis.com` and `https://fonts.gstatic.com`. The page's own CSP is untouched.
Both hosts are already trusted under `style-src` and `font-src`, so nothing new enters the trust
set — it becomes reachable from the one context that needs it. Cloudflare Pages applies the more
specific rule, which must be confirmed on the preview deploy and recorded in the file's comment
block with a date, as the existing 2026-06-30 CSP validation note is.

### Manifest and icons

Generated by the plugin from `vite.config.ts`:

- `name: "Magic Agenda"` — must match the OAuth consent screen and the `index.html` noscript block;
  the comment there says to keep them in sync, and Google's branding review is why it exists.
- `short_name: "Agenda"`, `id`/`start_url`/`scope: "/"`, `display: "standalone"`, no orientation
  lock (the board works in both).
- `theme_color` / `background_color`: `#0b0f1f`, the dark shell the landing page and noscript
  fallback already use. These are static while the app has three user-selectable themes, so the
  shell color is the honest choice.
- `icons`: 192 and 512 `purpose: "any"`, plus 512 `purpose: "maskable"`.

`start_url: "/"` lands on `HomeRoute`, which already branches: `Landing` signed-out, `BoardPage`
signed-in. Correct for both cases with no extra routing.

`public/favicon.svg` is a finished 512×512 app icon, but it is inset 16px with a 116px corner
radius, so under an Android mask its transparent corners show. A sibling `public/icon-maskable.svg`
carries the same art with the gradient bled to all four edges and the artwork scaled to ~78%, inside
the 80% safe circle. All three PNGs are rendered once from the two SVGs and committed beside the
existing `og.png` and `apple-touch-icon.png`. The constraint is a **one-shot renderer invoked
through `npx`, adding no permanent devDependency**; the implementation plan picks the specific tool
after checking it renders these gradients and the blur filter faithfully, and records the exact
command in a comment beside the assets so they can be regenerated. iOS ignores manifest icons and uses
`apple-touch-icon.png`, which already exists at 180×180 — no change.

### The snapshot

```ts
interface BoardSnapshotV1 {
  v: 1
  userId: string
  savedAt: number // epoch ms
  tasks: Task[] // board tasks (non-recurring + materialized instances)
  templates: Task[] // hidden recurrence templates
}

interface SettingsSnapshotV1 {
  v: 1
  userId: string
  settings: Settings // so the theme survives an offline boot
}
```

**Two keys, one per writer.** `useTasks` owns the board envelope; `SettingsProvider` owns the
settings envelope. A single shared key would mean two independent hooks doing read-modify-write on
the same string, where the later writer clobbers the other's field. They are also written at
different times — `SettingsProvider` mounts above `<Routes>` and resolves before `BoardPage` exists
at all — so there is no moment when one writer holds both halves.

`readBoard(userId)` / `readSettings(userId)` return `null` on a missing key, unparseable JSON, a `v`
mismatch, or a `userId` mismatch — a schema change is therefore a version bump, never a migration.
`clearSnapshots()` removes both and is what sign-out calls. Every access is `try`/`catch`-wrapped
and best-effort, exactly like `viewStorage.ts`: losing a snapshot is a degraded offline experience,
never a broken app.

**Templates must be in the envelope.** They live in `templatesRef`, outside the `tasks` list, and
without them an offline board silently loses the concept of a recurring series.

**Writes** happen in a debounced effect in `useTasks` after state settles. Because writes are
optimistic-then-rollback, a failed save re-renders the restored state and the next debounce writes
that — self-correcting, with no separate "confirmed" bookkeeping. Writes are suppressed while
offline-hydrated so `savedAt` never lies about freshness.

### Offline boot and hydration

`reload()`'s existing `if (err)` branch (plus the new defensive `catch`) gains hydration: if a
snapshot exists for this user, hydrate `tasks` and
`templatesRef` from it, set `offline`, and **skip `materialize()` entirely.**

That skip is the most dangerous line in the feature. `materialize()` inserts rows. Running it over
snapshot-hydrated state on a flaky connection risks duplicate instances colliding with the
`(recur_parent_id, recur_origin_day)` unique index — the same Postgres 23505 class the existing
StrictMode in-flight guard exists to prevent. A test asserts no insert is issued on the offline
path.

Reconnect needs no new code: `useTasks` already listens on `online` and `visibilitychange` and calls
`reload()`. Success clears `offline`, resumes materialization, and rewrites the snapshot.

### Auth while offline

supabase-js keeps its persisted session and retries when a refresh fails on the network — it clears
only on an explicit `invalid_grant` — so `session` normally stays non-null offline and
`ProtectedRoute` passes unchanged, even after the 1-hour `jwt_expiry` in `config.toml`.

Offline access should not rest on an undocumented behavior of a dependency, so `AuthProvider` also
mirrors the signed-in user id to `ma-last-user`, and `ProtectedRoute` renders its children rather
than redirecting when **all** of: no session, offline, and a snapshot exists for that id. Without
this, an offline user past the hour lands on a login form that cannot submit. Both paths get tests.

`signOut` clears the snapshot and `ma-last-user` before calling `supabase.auth.signOut()`; the
delete-account path clears them too.

### Read-only mode

`BoardPage` provides `ReadOnlyContext` from `useTasks`'s `offline` flag. Effects:

- `dragDisabled` becomes `filterActive || readOnly` — one boolean change at the existing provider.
- The add-task affordances are disabled with a title explaining why.
- `TaskEditor` opens in view-only mode: fields readable, save/delete hidden.
- Theme and view switching stay enabled — both are local UI, and `saveTheme` already tolerates a
  failed write.
- A banner above the board: "Offline — showing your board as of 12:41 PM. Changes are disabled,"
  from `savedAt`.

### Update flow

`Toast` is currently hardcoded to the error tone with a `Couldn't sync.` prefix. It gains
`tone: 'error' | 'info'` and an optional `action: { label, onClick }` rather than growing a
near-duplicate component. The update prompt uses it now ("New version — Refresh"); ROADMAP 4.6
(undo) reuses it later.

`registerSW.onUpdateReady` fires when a worker reaches `waiting`; `applyUpdate()` posts
`SKIP_WAITING` and reloads on `controllerchange`. Nothing auto-reloads — a board that refreshes
itself mid-drag is worse than a stale one.

## Testing

Test-first for the pure modules, per the repo convention for `src/data`, `src/dnd`, and `src/lib`.

| File                           | Covers                                                                                                                                                         |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sw/policy.test.ts`            | Every `*.supabase.co` URL is never cacheable (https and wss); hashed assets are cache-first; navigations are detected                                          |
| `data/snapshot.test.ts`        | Round trip; drop on `v` mismatch; drop on user mismatch; corrupt JSON → `null`; quota-exceeded write is swallowed                                              |
| `data/useTasks.test.ts`        | Error result + snapshot → tasks and templates hydrated, `offline` true, **no insert issued**; `online` event clears it; a thrown query is handled the same way |
| `data/useSettings.test.ts`     | Error result → snapshot settings, not `DEFAULTS`; `data: null` with no error → `DEFAULTS`; error with no snapshot → `DEFAULTS`                                 |
| `auth/ProtectedRoute.test.tsx` | Offline + no session + snapshot → renders children; offline + no session + no snapshot → redirects                                                             |
| `components/Board.test.tsx`    | Read-only: add disabled, drag disabled, editor view-only, banner shows the `savedAt` time                                                                      |
| `lib/registerSW.test.ts`       | Registers once under StrictMode; `onUpdateReady` fires on a waiting worker; `applyUpdate` posts and reloads                                                    |

The worker's event wiring cannot run in jsdom, which is precisely why the policy lives in pure
predicates. The wiring is verified by hand on the Cloudflare preview deploy: install on a real
iPhone and a real Android device, reload in airplane mode, and a two-deploy update round trip
confirming the toast appears and refreshing picks up the new build.

## Risks

**A bad service worker is the one artifact a merge to `main` cannot fix.** It lives on the user's
device and can keep serving a broken shell after the fix has shipped. Network-first navigation is
the structural mitigation, but mitigation is not a plan, so this work adds
`docs/runbooks/service-worker-rollback.md`: how to ship a worker that unregisters itself and clears
its caches, and how to confirm recovery. Runbooks are living documentation in this repo, and this is
exactly the situation they exist for.

**Task text at rest in `localStorage` is a new position for this app.** Sign-out wipes it, which is
what makes it defensible, and the data is already reachable via devtools by anyone who can open the
app — but it is a security-relevant decision and belongs in the next dated review in `private/`,
argued, rather than appearing quietly inside a feature PR.

**Smaller ones, handled in the design:** StrictMode double-registration is guarded and tested;
snapshot writes are best-effort against the storage quota; a first-time worker install needs no
deploy-window tolerance, since users on the old build simply have no worker and register on their
next visit.

## Out of scope

- Offline **writes** of any kind — no queue, no reconciler. Read-only is the whole offline story.
- Background sync and periodic background sync.
- Push notifications (ROADMAP 3.2, which this unblocks).
- Self-hosting the Google Fonts families. Runtime-caching them is enough for offline; self-hosting
  is a separate change with its own tradeoffs.

## Follow-ups this spec creates

1. `docs/runbooks/service-worker-rollback.md`, written in this PR and maintained with the worker.
2. The `localStorage` data-at-rest decision goes to the next security review in `private/`.
3. `_headers` gains a dated note recording that the `/sw.js` override was confirmed on a preview
   deploy.
4. ROADMAP 3.2 can start once this ships; 4.1 (stored timezone) is its other hard dependency.
