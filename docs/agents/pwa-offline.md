# Installable PWA and offline read

## Web Push

`src/notifications/pushGateway.ts` owns the browser subscription seam. Settings asks for
notification permission only from the explicit “Enable on this device” button, subscribes with the
public `VITE_VAPID_PUBLIC_KEY`, and stores the endpoint plus browser key material in the
Account-owned `push_subscriptions` table. Each browser or installed app is independent; the Account
lead in `user_settings.reminder_lead_minutes` enables or disables delivery across them. A deployment
without the public VAPID value stays usable and says that Push is unconfigured rather than throwing.

iOS and iPadOS expose standards-based Web Push only to a Home Screen web app. The Settings section
therefore gives install guidance before generic feature-detection messaging when it recognizes an
Apple mobile device outside standalone display mode. The actual capability decision remains feature
detection; user-agent recognition controls only that more useful explanation.

`src/sw.ts` handles `push` by always displaying a notification and handles `notificationclick` by
focusing an existing Magic Agenda window or opening one. `src/sw/notifications.ts` is the pure,
tested parser: push bytes are untrusted, text is bounded, and navigation is restricted to a
root-relative path. Keep this alongside the existing cache policy when changing the worker; Push
must not introduce a new cache path for Supabase or notification endpoints.

`supabase/functions/send-reminders` owns server delivery. Its domain planner imports the same
concrete-zone Due Moment implementation as the client, then derives a separate candidate for each
Account that currently belongs to the Task's Board. Inbox Tasks, Completed Tasks, and hidden Series
definitions are excluded. A zero-lead Reminder has one five-minute scheduler interval of grace
because no scheduler can observe it before the Due Moment; `tasks.updated_at` prevents a Task
created, rescheduled, or reopened after that instant from using the grace window to replay a missed
Reminder. Retry targets already created before the Due Moment may continue later, but every claim
rechecks current membership, preference, schedule, and Completion before sending.

The server-only `reminder_deliveries` row is Account × Task × Due Moment. A conditional claim with a
four-minute lease serializes overlapping scheduler runs. `reminder_delivery_targets` snapshots the
Account's enrolled devices on the first attempt, so a later retry sends only to the original device
set and skips devices that already succeeded. Transient failures back off per target; 404/410 marks
the target dead and removes its subscription. The sender exposes only aggregate counts and its logs
must never contain task titles, endpoints, subscription keys, provider response bodies, VAPID
material, or the dedicated cron bearer secret.

The Edge Function requires `VAPID_SUBJECT`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and
`REMINDER_CRON_SECRET` as runtime secrets. It deliberately has gateway JWT verification disabled:
the handler compares the opaque cron bearer secret itself, while ordinary users have neither table
access to delivery state nor execute access to the narrow `reminder_candidate_rows()` service RPC.
Deploy the function and its tables before adding the `pg_cron` invocation; that staging keeps a
release from scheduling code or credentials that do not exist yet.

The production schedule is named `send-task-reminders` and runs every five minutes. Its
`cron.job.command` contains only the Supabase Vault names `reminder_function_url` and
`reminder_cron_secret`; resolved values must never enter a migration, repository secret, issue,
log, or chat. The URL is the full `/functions/v1/send-reminders` endpoint. Keep the Vault bearer
value identical to the Edge Function's `REMINDER_CRON_SECRET`. A 401 from a manual unauthenticated
POST and an aggregate-only 200 from the Vault-backed invocation are the activation checks.

`src/sw.ts` is **hand-authored, not generated.** `vite-plugin-pwa` runs in `injectManifest` mode
(`vite.config.ts`), which only supplies `self.__WB_MANIFEST` (the precache URL list) — none of
workbox's runtime-caching strategies ship in the built worker; every `fetch` handler in `sw.ts` is
ours. The load-bearing decision is that **navigations are network-first**
(`isNavigation()` in `src/sw/policy.ts`, dispatched from `sw.ts`'s `fetch` listener): a service
worker is the one deployed artifact a merge to `main` cannot reach directly, since it lives on the
user's device and only updates when the browser byte-compares `/sw.js` on a later navigation. If
navigations were cache-first, a bad deploy could make itself permanent for anyone who installed
the worker before the fix shipped — see `docs/runbooks/service-worker-rollback.md`, which exists
specifically because that failure mode has no other way back. Only content-hashed build assets
under `/assets/` and the two Google Fonts hosts are cache-first (`isCacheFirst()`); everything else,
including `/index.html` itself, goes to the network first and falls back to cache only when the
fetch throws.

**`*.supabase.co` is never written to any cache, over any scheme** (`isNeverCached()` — matches
both `https://` REST calls and the `wss://` realtime socket). A cache is a single, unscoped bucket
shared by every profile that has ever used the browser profile; caching an authenticated Supabase
response would leak one user's data to the next person who opens the app on that device. This
predicate is checked before the navigation branch, so it wins even for a Supabase URL that also
looks like a navigation. The rule and its edge cases (a lookalike hostname, `wss://`) are pinned in
`src/sw/policy.test.ts` — `src/sw.ts` itself cannot be unit-tested (no service-worker runtime in
jsdom), so this pure-predicate split is what makes the policy testable at all. Do not weaken or
delete these tests; they are the single most load-bearing check in this subsystem.

`public/_headers` trusts `fonts.googleapis.com`/`fonts.gstatic.com` in the **site-wide**
`connect-src`. That is deliberate and was arrived at the hard way — do not "tighten" it back to a
per-path rule. The asymmetry to understand: the page's own `<link>` to the Google Fonts stylesheet
is governed by `style-src` (always allowed), but the **service worker's** `fetch()` of that same
URL is governed by `connect-src`. Until v1.2.37 this file tried to widen `connect-src` for the
worker alone via a second rule scoped to the `/sw.js` response path. **That does not work, and it
is now confirmed in production, not theorised**: a scoped `_headers` rule does not replace the
site-wide one for that request, so the worker's fetch stayed bound by the narrower directive and
was refused —

```
Failed to load 'https://fonts.googleapis.com/css2?family=…'.
A ServiceWorker passed a promise to FetchEvent.respondWith() that rejected with
'TypeError: NetworkError when attempting to fetch resource.'
```

It only bit **returning** visitors, which is why it survived a preview-deploy smoke test: on a
first visit the worker is not yet controlling the page, so the fonts load normally and land in the
HTTP cache; on the next visit the worker intercepts and is blocked. Because `cacheFirst` had no
network-failure fallback, that rejection reached `respondWith()` and took out the whole stylesheet
for every controlled page — typography silently degraded to system fonts. `cacheFirst` now catches:
it retries the cache with `ignoreSearch` (Google Fonts URLs carry a long `family=` query) and
otherwise returns `Response.error()`, so a refused fetch costs one asset instead of the page. **That
catch is load-bearing — a `throw` there is a page-level outage, not a missing font.**

`script-src` also carries a sha256 for Cloudflare's auto-injected Web Analytics inline loader plus
`static.cloudflareinsights.com`, with `cloudflareinsights.com` in `connect-src`. The hash is
Cloudflare's snippet, not ours: a beacon update can change it and silently re-break analytics (the
app is unaffected). The beacon reads the live `document.location.href` when it initializes; it does
not recover the original navigation URL from Navigation Timing. That makes enabling analytics safe
for emailed `/auth/reset` and `/auth/confirm` links only because the blocking same-origin
`/auth-token-bootstrap.js` is first in `<head>`, captures their `token_hash` in closure memory, and
scrubs the query before the injected end-of-body script can run. A module script is not equivalent:
the browser can run a later tiny deferred script while the module's dependency graph is still
loading. Do not move the scrub into the app module or an effect. If the console reports a blocked
inline script, copy the hash from that message into `script-src`.

Offline read uses three versioned `localStorage` envelopes, all in `src/data/snapshot.ts` and all
keyed to the signed-in user id: a board snapshot **per Board** (`ma-snapshot-board.<boardId>`;
tasks, the hidden recurrence templates, and a `savedAt` timestamp), a directory snapshot (which
Boards this device last saw — and only that; it carried the open Board's id until #331, which
nothing ever read back, the live selection coming from `ma-selected-board` instead), and a settings
snapshot. The calendar feed's Membership token (#277) is deliberately never in any of these: it is
a working read capability, read on demand into component state by `src/board/calendarFeed.ts` and
dropped when its panel closes. One account can hold several board snapshots at once, so the board
key is namespaced rather than singular — that is also what makes purging one Board's snapshot
possible without clearing every cached Board to do it.
`useTasks` treats visible Tasks and hidden Series definitions as independent debounce triggers for
rewriting that Board envelope; watching only the visible `tasks` state leaves a template-only
realtime edit stale offline even though the snapshot persists both collections.
`cachedBoardIds()` enumerates them by a `localStorage` prefix scan for the two callers that cannot
yet name a Board: `hasAnyBoardSnapshot()` (the offline-boot gate checked in `App` and
`ProtectedRoute` before a Board is selected or even known) and `clearSnapshots()`'s sign-out sweep. A version, user-id, or
**board-id** mismatch drops the envelope rather than migrating it. The version is **one constant
shared by all three**, so bumping it for a shape change in one drops the other two as well — cheap,
since each is a cache the next successful load rewrites, but it is why a bump shows up as failures
in the settings and route tests too. A board snapshot's own `boardId`
field guards against a hand-edited or collided key rendering one Board's tasks under another Board's
name. **All three are cleared on `SIGNED_OUT`** (`AuthProvider`) — that clearing is the entire
justification for storing task text at rest in `localStorage` in the first place; see the dated
security review in `private/` before changing what gets persisted or when it's cleared. Two smaller
keys are swept beside them from the same block and are the reason to state the rule as _everything_
rather than _the snapshots_: `ma-last-user` (`lib/lastUser.ts`) and `ma-selected-board`
(`board/rememberedBoard.ts`, shaped like `lib/viewStorage.ts` and cleared next to it). The second
was the one exception until #298, harmless on its own — a Board id grants nothing and
`resolveSelection` falls back when it names a Board the next account cannot see — which is exactly
why it survived: a rule with a harmless exception is still a rule nobody can rely on. `useTasks`
hydrates from the board snapshot only when a server load fails, and deliberately **skips
`materialize()`** on that path — running recurrence materialization over snapshot state would insert
duplicate instance rows and hit `tasks_recur_instance_uniq` (Postgres 23505) the moment connectivity
returns and the real load reruns. `useSettings` falls back to the settings snapshot on a failed load
too, instead of silently resetting the user's theme to `DEFAULTS`. `useBoardDirectory` purges the
snapshots of Boards the server no longer returns — computed from the server's list via
`purgeableBoardIds()`, never from what is cached locally, so a load that returns nothing purges
everything rather than preserving it — but only under a real session, since a sessionless read
succeeding with `[]` must not be read as "this Account has no Boards" (the same hazard
`canPersistSnapshot` exists to prevent elsewhere).

`tsconfig.worker.json` is a **third project-reference sibling** (alongside the app and node
configs): it gives `src/sw.ts` and `src/sw/policy.ts` the WebWorker lib with no DOM, so the worker
can't accidentally reference `window` or `document`. Its `include` is an explicit two-file list,
not a glob, specifically to keep `src/sw/policy.test.ts` out of this project — that test typechecks
today only by accident, and the first ambient-globals or DOM-typed assertion added to it would
break `tsc -b` from a project it has no business being part of.
