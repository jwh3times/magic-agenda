# Public Landing Page — Design

- **Date:** 2026-07-27
- **Status:** Shipped as v1.2.28 (PR #101), with two page-content follow-ups in v1.2.29 (PR #102) —
  see the correction under "Follow-ups this spec creates"
- **Delivers:** ROADMAP 5.1 (public landing page), 5.3 (Privacy/Terms links while logged in), and
  5.2 (official Google mark on the OAuth button) as one bundle.

## Problem

`magicagenda.app` routes straight to a login wall: `/` sits inside `ProtectedRoute`, so a signed-out
visitor is redirected to `/login` and never sees what the product is. Google's OAuth branding
verification fails on exactly this — the home page is behind a login and does not explain the app's
purpose. Verification also has **external review lead time**, which is why this is scheduled ahead of
larger items: the clock runs without us.

Secondary: the legal pages are reachable from the login screen and `/settings`, but not from the
board's mobile chrome (5.3), and the "Continue with Google" button uses a generic blue "G" rather
than Google's mark, which their branding guidelines require (5.2).

## Decisions

| Question                               | Decision                                                                       | Why                                                                                                                               |
| -------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| How does `/` serve two audiences?      | `HomeRoute` branches on session; signed-in still renders `BoardPage`           | No URL migration, no broken bookmarks, no second domain                                                                           |
| How is the product shown?              | A **live mini-board** rendered from `makeMockTasks()` and the real theme layer | Cannot go stale — it _is_ the component. No screenshots to capture, commit at 2× or re-take on every UI change                    |
| Does the preview persist theme choice? | No — its own `ThemeProvider` with local state and no `onThemeChange`           | A visitor toggling themes must never write to `user_settings`, and a signed-in user's saved theme must not change by visiting `/` |
| Landing eager or lazy?                 | **Eager**; `BoardPage` stays lazy                                              | Signed-out is the cold-visitor path; a spinner is the worst possible first frame for a marketing page and for a reviewer          |
| Where does the preview live?           | `src/components/landing/`                                                      | Keeps `components/` root for board UI                                                                                             |

## Architecture

### Routing

`/` moves from `ProtectedRoute` to a `HomeRoute` that branches:

```tsx
const { session, loading, passwordRecovery } = useAuth()
if (loading) return <Spinner />
if (!session) return <Landing />
if (passwordRecovery) return <Navigate to="/auth/reset" replace />
return (
  <Suspense fallback={<Spinner label="Loading…" />}>
    <BoardPage />
  </Suspense>
)
```

**The `passwordRecovery` branch is load-bearing and must not be dropped.** It is part of the
v1.2.19 session-fixation work: a recovery-link session must set a new password before reaching the
board. A naive `session ? <BoardPage/> : <Landing/>` silently removes that guard. A regression test
pins it.

`loading` resolves from `localStorage` with no network round trip, so the spinner is a few
milliseconds and needs no optimisation. `/settings` keeps `ProtectedRoute` unchanged.

### The mini-board

`src/components/landing/BoardPreview.tsx` renders 3–4 day cells with `cellChrome`, `weekdayStyle`,
and `gapStyle`, filled with real `TaskCard`s from `makeMockTasks()`. This works because of an
existing boundary worth stating: **`TaskCard` is purely presentational and imports no dnd-kit** —
drag lives entirely in `Board.tsx` and `src/dnd/`. `selectors.ts` is likewise pure. So the landing
page reuses the genuine card rendering (rotation, pins, DONE stamp, per-theme shadow and blur) with
no drag or data layer behind it.

It wraps its own `<ThemeProvider initial={theme}>` over local state. A three-way toggle (Cork /
Neon-Brutalist / Aurora-Glass) sits beneath it, which is the cheapest possible demonstration of the
app's most distinctive feature.

**The preview is decoration, not UI.** It carries `inert` and `aria-hidden`, and is passed no
handlers — so it is inert by construction rather than by `pointer-events`. It must never be
focusable: a keyboard user tabbing through a marketing page into fake task cards is a bug.

Mobile drops to two columns via the existing `useIsMobile()`; no CSS media queries, per the
inline-style model.

### Bundle

`Landing` is imported eagerly, matching how `Login` is already handled; `BoardPage` remains lazy so
dnd-kit stays out of the first load. Supabase is **not** avoidable and never was — `AuthProvider` is
eager, so the client is in the entry chunk for every visitor including signed-out ones. Only dnd-kit
is genuinely deferred.

`BoardPreview` is itself lazy **inside** `Landing`. Measured: importing it eagerly grew the entry
chunk 459.7 → 491.7 kB, because `TaskCard`, `cardStyles`, `chrome`, and the mock board hoist into
the chunk every visitor pays for. Splitting it holds the entry chunk at 465.5 kB (+1.9 kB gzip over
baseline) and moves ~27 kB behind first paint, where it is also shared with `BoardPage` — which
shrank 100.1 → 90.6 kB as a result. The hero, the copy, and the CTA are what Google's reviewer and a
new visitor need immediately; the preview is below them and can arrive a moment later behind a
fixed-height placeholder that prevents layout shift.

## Content

> **Your week, on sticky notes.**
>
> A drag-and-drop task board that feels like a corkboard, not a spreadsheet. Three themes, recurring
> tasks, due times — synced across every device.

Primary CTA "Get started" → `/login`; secondary "Sign in" in the nav. Feature bullets are drawn from
`README.md` so there is one source of truth for how the product is described: drag & drop across
days, four views, recurring tasks, due times & pins, overdue roll-forward, export & import, works on
your phone. Footer carries Privacy · Terms.

## Also in this change

- **5.3** — a link row (Privacy · Terms) in the mobile toolbar overflow. Desktop and `/settings`
  already have them; only the phone chrome is missing them.
- **5.2** — the official multi-colour Google mark as an inline SVG in `Login.tsx`, replacing the
  blue "G". Inline because `public/_headers` sets `script-src 'self'` and we add no external assets.
- Per-route `<title>` and description via a small `useDocumentTitle` hook — no new dependency, and
  the static `index.html` og/twitter tags stay as the sitewide default.

## Testing

- `Landing` renders the headline, both CTAs, and the legal links.
- `/` renders `Landing` when signed out and `BoardPage` when signed in.
- **A recovery session at `/` still redirects to `/auth/reset`** — the regression guard for the
  routing change above.
- The theme toggle changes the rendered preview's styling.
- The preview is `aria-hidden` and contains no focusable elements.
- Mobile layout with a stubbed `matchMedia`, per the existing pattern in `Board.test.tsx`.

## Manual steps (not in the PR)

1. Verify `magicagenda.app` in Google Search Console.
2. Re-request OAuth branding verification.

The landing page removes the blocker; it does not complete the review.

## Out of scope

- A second domain or a marketing site — the app's own `/` is the home page.
- Analytics of any kind. Adding a tracker would mean revisiting the CSP and the privacy policy in
  the same breath; it is not needed to unblock verification.
- Screenshots, `og:image` per route, and any binary asset. The live preview replaces them.
- Copy testing / SEO work beyond a truthful title and description.

## Follow-ups this spec creates

1. ~~If Google's review still fails after verification, the remaining gap is likely domain ownership
   rather than page content — re-read their rejection before changing the page.~~
   **Wrong, corrected 2026-07-27 (v1.2.29).** Google's rejection named two page-content gaps this
   design missed:
   - **The app is client-rendered, so the served `<body>` is an empty `<div id="root">`.** A checker
     that does not execute JavaScript sees no content at all — which reads as both "behind a login"
     and "does not explain the purpose", the two things this page was built to fix. Addressed with a
     `<noscript>` block in `index.html` carrying the app name, the purpose, and the legal links. If a
     future review still fails on content, the escalation is pre-rendering the landing route at build
     time rather than adding more meta tags.
   - **The app name existed only as `alt` text and a footer copyright line.** The header logo is an
     `<img>`, and the wordmark inside that SVG (lowercase "magic agenda") is invisible to the DOM, so
     nothing on the page matched the consent screen's "Magic Agenda". The header now renders the name
     as text beside the icon mark, and the hero sentence names the app.
2. ROADMAP 5.6 (custom auth domain) removes the `…supabase.co` host from the consent screen and
   pairs naturally with this, but is Pro-gated and remains a cost decision.
