# PKCE Auth Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **MANUAL GATES:** Tasks 5, 7, 8, and 9 are **manual gates** — steps only Jerry can perform in the
> Supabase dashboard / GitHub, or timing decisions only Jerry can make. At each gate the
> orchestrator MUST stop, present the gate's checklist to Jerry directly (AskUserQuestion or a
> plain prompt in the main session — never inside a subagent), and WAIT for explicit confirmation
> before continuing. Do not mark a gate complete on Jerry's behalf.

**Spec:** `docs/specs/2026-07-25-pkce-auth-flow-design.md` (read it before starting — it contains
the verified library analysis this plan builds on)

**Goal:** Close the session-fixation vector (implicit-flow fragment tokens) by disabling implicit
detection (`detectSessionInUrl: () => false` + `flowType: 'pkce'`) and moving both email flows to
explicit `verifyOtp({ token_hash })` redemption.

**Architecture:** One-line security fix in the Supabase client config; `ResetPassword` reworked to
redeem `?token_hash=` once and render the form on `session && passwordRecovery`; a new
`AuthConfirm` page redeems signup tokens and signs the user straight in; `Login` points signup
emails at `/auth/confirm`. `AuthProvider`, `ProtectedRoute`, and `AuthCallback` are unchanged —
`verifyOtp` fires `PASSWORD_RECOVERY` itself (verified at `GoTrueClient.js:2021`, auth-js 2.110.8).

**Tech Stack:** React 19 + TypeScript, react-router v8 (`react-router` package), Vitest +
Testing Library (jsdom), `@supabase/supabase-js` (auth-js 2.110.8).

## Global Constraints

- Branch: work happens on the existing `feat/pkce-auth-flow` branch. `main` is PR-only; the `ship`
  skill handles changelog/PR (Task 6).
- **Do NOT modify** `src/auth/AuthProvider.tsx`, `src/auth/ProtectedRoute.tsx`, or
  `src/pages/AuthCallback.tsx`. The spec's revised design requires zero changes there.
- Redemption must run **exactly once per mount** (ref guard): `main.tsx` uses `StrictMode`, which
  double-invokes effects in dev, and `token_hash` is single-use.
- The reset form renders on `session && passwordRecovery` — never on "verifyOtp succeeded in this
  mount" (reload / re-entry rule; spec section "Single-use tokens").
- Neither page redeems a token while any session exists (fixation guard; spec "Residual risk").
- Client config must be exactly `flowType: 'pkce'` **and** `detectSessionInUrl: () => false` —
  `flowType` alone does not close the hole (spec "The correction that shapes this design").
- Copy strings are exact where quoted in tasks (tests assert on them).
- Tests: `npx vitest run <file>` per task; full `npm test` + `npm run lint` +
  `npm run format:check` + `npm run build` before shipping.
- Commit style: lowercase `type: subject` (e.g. `feat: …`, `test: …`), matching repo history.

---

### Task 1: Client configuration — the security fix

**Files:**

- Modify: `src/lib/supabase.ts`
- Test (create): `src/lib/supabase.test.ts`

**Interfaces:**

- Consumes: nothing from other tasks.
- Produces: the exported `supabase` singleton now has `flowType: 'pkce'` and function-form
  `detectSessionInUrl`. Later tasks call `supabase.auth.verifyOtp(...)` (already part of the SDK).

This test imports the real client (safe: `vite.config.ts` injects dummy `VITE_SUPABASE_*` env for
tests, and no network call happens unless a method is invoked). It reaches into two runtime
properties that are `protected` in the TypeScript types — hence the cast — because they are the
regression guard for the actual vulnerability: someone "simplifying" the config back to
`detectSessionInUrl: true` must fail this test.

- [ ] **Step 1: Write the failing test**

Create `src/lib/supabase.test.ts`:

```ts
import { expect, test } from 'vitest'
import { supabase } from './supabase'

// Regression guard for the 2026-07-25 security review Finding 1 (session fixation).
// flowType 'pkce' alone does NOT close the hole: auth-js classifies fragment URLs as
// implicit callbacks regardless of flowType. The function form of detectSessionInUrl
// is the real control — _isImplicitGrantCallback delegates to it.
test('auth client uses PKCE and never adopts implicit-grant tokens from the URL', () => {
  const auth = supabase.auth as unknown as {
    flowType: string
    detectSessionInUrl: boolean | ((url: URL, params: Record<string, string>) => boolean)
  }
  expect(auth.flowType).toBe('pkce')
  expect(typeof auth.detectSessionInUrl).toBe('function')
  const detect = auth.detectSessionInUrl as (url: URL, params: Record<string, string>) => boolean
  expect(
    detect(new URL('https://magicagenda.app/#access_token=evil&refresh_token=evil'), {
      access_token: 'evil',
      refresh_token: 'evil',
    }),
  ).toBe(false)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/supabase.test.ts`
Expected: FAIL — `auth.flowType` is `'implicit'` (the auth-js default), not `'pkce'`.

- [ ] **Step 3: Change the client config**

In `src/lib/supabase.ts`, replace the `createClient` call:

```ts
/** Typed Supabase singleton. The anon key is public by design; safety comes from RLS. */
export const supabase = createClient<Database>(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    flowType: 'pkce',
    // Never adopt implicit-grant tokens from a URL fragment: that path has no
    // state/nonce binding and is the session-fixation vector. Email links now
    // carry ?token_hash= and are redeemed explicitly via verifyOtp().
    detectSessionInUrl: () => false,
  },
})
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/supabase.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full suite to catch fallout**

Run: `npm test`
Expected: PASS — every page test mocks `../lib/supabase`, so nothing else touches this config.

- [ ] **Step 6: Commit**

```bash
git add src/lib/supabase.ts src/lib/supabase.test.ts
git commit -m "fix: disable implicit-grant URL token adoption (PKCE + detectSessionInUrl guard)"
```

---

### Task 2: ResetPassword — redeem token_hash, render on recovery state

**Files:**

- Modify: `src/pages/ResetPassword.tsx` (full rewrite of the top half; the form + submit handler
  are unchanged)
- Modify: `src/pages/ResetPassword.test.tsx`

**Interfaces:**

- Consumes: `supabase.auth.verifyOtp({ token_hash: string, type: 'recovery' })` →
  `Promise<{ data: object, error: Error | null }>`; `useAuth()` (unchanged shape:
  `{ session, loading, passwordRecovery, clearPasswordRecovery }`).
- Produces: nothing other tasks consume. Behavior contract: form on
  `session && passwordRecovery`; refusal card on any other session; spinner while redeeming;
  invalid/expired card otherwise.

State machine being implemented (from the spec):

| Auth state                     | URL                             | Render                                                                                      |
| ------------------------------ | ------------------------------- | ------------------------------------------------------------------------------------------- |
| `loading`                      | —                               | `<Spinner />`                                                                               |
| `session && passwordRecovery`  | any                             | password form (fresh verify, reload, or re-entry)                                           |
| `session && !passwordRecovery` | any                             | "already signed in" refusal — never redeems                                                 |
| no session                     | `?token_hash=…`, not yet failed | `<Spinner label="Checking your reset link…" />`, effect redeems **once** and scrubs the URL |
| no session                     | no token, or redemption failed  | existing "invalid or has expired" card                                                      |

- [ ] **Step 1: Update the test harness and add the failing tests**

Replace `src/pages/ResetPassword.test.tsx` in full (existing four tests are kept, adjusted only
where the harness changed — `verifyOtp` added to the supabase mock, URL reset in `beforeEach`,
explicit `passwordRecovery` per test):

```tsx
import { StrictMode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
  updateUser: vi.fn(() => Promise.resolve({ data: {}, error: null })),
  verifyOtp: vi.fn(() => Promise.resolve({ data: {}, error: null })),
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
  supabase: { auth: { updateUser: h.updateUser, verifyOtp: h.verifyOtp } },
}))

vi.mock('../auth/AuthProvider', () => ({ useAuth: () => h.auth.current }))

import { ResetPassword } from './ResetPassword'

beforeEach(() => {
  h.updateUser.mockClear()
  h.verifyOtp.mockClear()
  h.verifyOtp.mockImplementation(() => Promise.resolve({ data: {}, error: null }))
  h.auth.current.clearPasswordRecovery = h.clearPasswordRecovery
  h.clearPasswordRecovery.mockClear()
  h.auth.current.session = { user: { id: 'u1' } }
  h.auth.current.passwordRecovery = true
  // The component reads window.location.search directly (one-shot at mount).
  window.history.replaceState(null, '', '/auth/reset')
})

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/auth/reset']}>
      <ResetPassword />
    </MemoryRouter>,
  )
}

// ——— existing behavior, unchanged ———

test('rejects mismatched passwords without calling supabase', async () => {
  renderPage()
  await userEvent.type(screen.getByPlaceholderText('New password'), 'longenough123!')
  await userEvent.type(screen.getByPlaceholderText('Confirm new password'), 'different123!')
  await userEvent.click(screen.getByRole('button', { name: 'Set new password' }))
  expect(await screen.findByText('Passwords do not match.')).toBeInTheDocument()
  expect(h.updateUser).not.toHaveBeenCalled()
})

test('updates the password and clears the recovery flag on success', async () => {
  renderPage()
  await userEvent.type(screen.getByPlaceholderText('New password'), 'longenough123!')
  await userEvent.type(screen.getByPlaceholderText('Confirm new password'), 'longenough123!')
  await userEvent.click(screen.getByRole('button', { name: 'Set new password' }))
  expect(h.updateUser).toHaveBeenCalledWith({ password: 'longenough123!' })
  expect(h.clearPasswordRecovery).toHaveBeenCalled()
})

test('a thrown (rejected) update surfaces an error and clears busy', async () => {
  h.updateUser.mockRejectedValueOnce(new Error('network exploded'))
  renderPage()
  await userEvent.type(screen.getByPlaceholderText('New password'), 'longenough123!')
  await userEvent.type(screen.getByPlaceholderText('Confirm new password'), 'longenough123!')
  const btn = screen.getByRole('button', { name: 'Set new password' })
  await userEvent.click(btn)
  expect(await screen.findByText('network exploded')).toBeInTheDocument()
  expect(h.clearPasswordRecovery).not.toHaveBeenCalled()
  expect(btn).toBeEnabled() // busy cleared, not stuck disabled
})

test('shows the expired-link screen when there is no session and no token', () => {
  h.auth.current.session = null
  h.auth.current.passwordRecovery = false
  renderPage()
  expect(screen.getByText(/invalid or has expired/)).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Back to sign in' })).toHaveAttribute('href', '/login')
})

// ——— new: token_hash redemption ———

test('redeems the token exactly once under StrictMode and scrubs it from the URL', async () => {
  h.auth.current.session = null
  h.auth.current.passwordRecovery = false
  window.history.replaceState(null, '', '/auth/reset?token_hash=tok123&type=recovery')
  render(
    <StrictMode>
      <MemoryRouter initialEntries={['/auth/reset']}>
        <ResetPassword />
      </MemoryRouter>
    </StrictMode>,
  )
  await waitFor(() => expect(h.verifyOtp).toHaveBeenCalledTimes(1))
  expect(h.verifyOtp).toHaveBeenCalledWith({ token_hash: 'tok123', type: 'recovery' })
  expect(window.location.search).toBe('') // spent token never lingers in the URL/history
})

test('shows a spinner, not the error card, while the token is being redeemed', () => {
  h.auth.current.session = null
  h.auth.current.passwordRecovery = false
  h.verifyOtp.mockImplementation(() => new Promise(() => {})) // never resolves
  window.history.replaceState(null, '', '/auth/reset?token_hash=tok123&type=recovery')
  renderPage()
  expect(screen.getByText('Checking your reset link…')).toBeInTheDocument()
  expect(screen.queryByText(/invalid or has expired/)).not.toBeInTheDocument()
})

test('a failed redemption shows the invalid-or-expired card', async () => {
  h.auth.current.session = null
  h.auth.current.passwordRecovery = false
  h.verifyOtp.mockImplementation(() =>
    Promise.resolve({ data: {}, error: new Error('Token has expired') }),
  )
  window.history.replaceState(null, '', '/auth/reset?token_hash=bad&type=recovery')
  renderPage()
  expect(await screen.findByText(/invalid or has expired/)).toBeInTheDocument()
})

test('a recovery session with no token still gets the form (reload / re-entry)', () => {
  // After a successful verify the token is spent and scrubbed; reloading or being
  // bounced back by ProtectedRoute must land on the form, not the error card.
  renderPage()
  expect(screen.getByPlaceholderText('New password')).toBeInTheDocument()
  expect(h.verifyOtp).not.toHaveBeenCalled()
})

test('refuses to redeem over an existing non-recovery session', () => {
  h.auth.current.passwordRecovery = false
  window.history.replaceState(null, '', '/auth/reset?token_hash=tok123&type=recovery')
  renderPage()
  expect(screen.getByText(/already signed in/)).toBeInTheDocument()
  expect(h.verifyOtp).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `npx vitest run src/pages/ResetPassword.test.tsx`
Expected: the four "existing behavior" tests PASS; the five new tests FAIL (component never calls
`verifyOtp`, has no spinner/refusal states).

- [ ] **Step 3: Rewrite the component's top half**

Replace `src/pages/ResetPassword.tsx` with (the `submit` handler and the form JSX are byte-for-byte
the current ones — only imports, the doc comment, the hooks/effect, and the pre-form branches
change):

```tsx
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { supabase } from '../lib/supabase'
import { errorMessage } from '../lib/errors'
import { useAuth } from '../auth/AuthProvider'
import { Spinner } from '../components/Spinner'
import { authCard, authField, authPage, authSubmit } from './authChrome'
import logoDark from '../assets/logo-dark.svg'

// Mirror of Login's SIGNUP_MIN_PASSWORD — the Supabase dashboard policy is the real control.
const MIN_PASSWORD = 10

/**
 * Password-recovery landing page. The emailed link carries ?token_hash=…&type=recovery,
 * redeemed here exactly once via verifyOtp — which fires PASSWORD_RECOVERY, so
 * AuthProvider raises the per-tab recovery flag. The form renders on
 * (session && passwordRecovery), never on "verifyOtp succeeded in this mount": the token
 * is single-use, and a reload or ProtectedRoute bounce after it is spent must still land
 * on the form. A non-recovery session never redeems (session-fixation guard).
 */
export function ResetPassword() {
  const { session, loading, passwordRecovery, clearPasswordRecovery } = useAuth()
  const navigate = useNavigate()
  // One-shot: capture the token at mount; the redeem effect scrubs it from the URL.
  const [tokenHash] = useState(() => new URLSearchParams(window.location.search).get('token_hash'))
  const redeemed = useRef(false)
  const [verifyError, setVerifyError] = useState<string | null>(null)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // Redeem exactly once: the token is single-use and StrictMode double-invokes
    // effects. Any existing session skips redemption entirely.
    if (loading || redeemed.current || session || !tokenHash) return
    redeemed.current = true
    window.history.replaceState(window.history.state, '', window.location.pathname)
    supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'recovery' }).then(({ error: err }) => {
      if (err) setVerifyError(errorMessage(err))
    })
  }, [loading, session, tokenHash])

  if (loading) return <Spinner />

  const showForm = Boolean(session) && passwordRecovery

  if (!showForm && session) {
    return (
      <div style={authPage}>
        <div style={authCard}>
          <img
            src={logoDark}
            alt="Magic Agenda"
            style={{ height: 110, display: 'block', margin: '0 0 6px' }}
          />
          <p style={{ margin: '0 0 18px', fontSize: 14, lineHeight: 1.5, opacity: 0.75 }}>
            You’re already signed in, so this reset link wasn’t used. To reset a password, sign out
            first and request a new link.
          </p>
          <Link to="/" style={{ color: '#a78bfa', fontWeight: 700, fontSize: 14 }}>
            Back to your board
          </Link>
        </div>
      </div>
    )
  }

  if (!showForm && tokenHash && !verifyError) return <Spinner label="Checking your reset link…" />

  if (!showForm) {
    return (
      <div style={authPage}>
        <div style={authCard}>
          <img
            src={logoDark}
            alt="Magic Agenda"
            style={{ height: 110, display: 'block', margin: '0 0 6px' }}
          />
          <p style={{ margin: '0 0 18px', fontSize: 14, lineHeight: 1.5, opacity: 0.75 }}>
            This password reset link is invalid or has expired. Request a new one from the sign-in
            page.
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
    try {
      const { error: err } = await supabase.auth.updateUser({ password })
      if (err) throw err
    } catch (err) {
      setError(errorMessage(err))
      return
    } finally {
      setBusy(false)
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
            At least 10 characters, including upper- and lower-case letters, a number, and a symbol.
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

- [ ] **Step 4: Run the tests to verify all pass**

Run: `npx vitest run src/pages/ResetPassword.test.tsx`
Expected: all 9 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pages/ResetPassword.tsx src/pages/ResetPassword.test.tsx
git commit -m "feat: redeem recovery token_hash via verifyOtp on /auth/reset"
```

---

### Task 3: AuthConfirm page + public route

**Files:**

- Create: `src/pages/AuthConfirm.tsx`
- Create: `src/pages/AuthConfirm.test.tsx`
- Modify: `src/App.tsx` (route registration)

**Interfaces:**

- Consumes: `supabase.auth.verifyOtp({ token_hash: string, type: 'signup' })`; `useAuth()`
  (`{ session, loading }`).
- Produces: `AuthConfirm` component (named export) registered at public route `/auth/confirm`.
  Task 4's `emailRedirectTo` points at this route.

- [ ] **Step 1: Write the failing tests**

Create `src/pages/AuthConfirm.test.tsx`:

```tsx
import { StrictMode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
  verifyOtp: vi.fn(() => Promise.resolve({ data: {}, error: null })),
  auth: {
    current: {
      session: null as unknown,
      user: null as unknown,
      loading: false,
      passwordRecovery: false,
      clearPasswordRecovery: vi.fn(),
      signOut: vi.fn(),
    },
  },
}))

vi.mock('../lib/supabase', () => ({
  supabase: { auth: { verifyOtp: h.verifyOtp } },
}))

vi.mock('../auth/AuthProvider', () => ({ useAuth: () => h.auth.current }))

import { AuthConfirm } from './AuthConfirm'

beforeEach(() => {
  h.verifyOtp.mockClear()
  h.verifyOtp.mockImplementation(() => Promise.resolve({ data: {}, error: null }))
  h.auth.current.session = null
  window.history.replaceState(null, '', '/auth/confirm')
})

function pageTree() {
  return (
    <MemoryRouter initialEntries={['/auth/confirm']}>
      <Routes>
        <Route path="/auth/confirm" element={<AuthConfirm />} />
        <Route path="/" element={<div>BOARD</div>} />
        <Route path="/login" element={<div>LOGIN</div>} />
      </Routes>
    </MemoryRouter>
  )
}

test('redeems the token exactly once under StrictMode and scrubs it from the URL', async () => {
  window.history.replaceState(null, '', '/auth/confirm?token_hash=tok9&type=signup')
  render(<StrictMode>{pageTree()}</StrictMode>)
  await waitFor(() => expect(h.verifyOtp).toHaveBeenCalledTimes(1))
  expect(h.verifyOtp).toHaveBeenCalledWith({ token_hash: 'tok9', type: 'signup' })
  expect(window.location.search).toBe('')
})

test('a successful redemption lands on the board once the session arrives', async () => {
  window.history.replaceState(null, '', '/auth/confirm?token_hash=tok9&type=signup')
  const view = render(pageTree())
  await waitFor(() => expect(h.verifyOtp).toHaveBeenCalledTimes(1))
  // verifyOtp fired SIGNED_IN; simulate AuthProvider exposing the new session.
  h.auth.current.session = { user: { id: 'u1' } }
  view.rerender(pageTree())
  expect(await screen.findByText('BOARD')).toBeInTheDocument()
})

test('refuses to redeem over an existing session', () => {
  h.auth.current.session = { user: { id: 'u1' } }
  window.history.replaceState(null, '', '/auth/confirm?token_hash=tok9&type=signup')
  render(pageTree())
  expect(screen.getByText(/already signed in/)).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Back to your board' })).toHaveAttribute('href', '/')
  expect(h.verifyOtp).not.toHaveBeenCalled()
})

test('a failed redemption shows the error card with a link to sign in', async () => {
  h.verifyOtp.mockImplementation(() =>
    Promise.resolve({ data: {}, error: new Error('Token has expired') }),
  )
  window.history.replaceState(null, '', '/auth/confirm?token_hash=bad&type=signup')
  render(pageTree())
  expect(await screen.findByText(/invalid or has expired/)).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Back to sign in' })).toHaveAttribute('href', '/login')
})

test('a missing token shows the error card without calling verifyOtp', () => {
  render(pageTree())
  expect(screen.getByText(/invalid or has expired/)).toBeInTheDocument()
  expect(h.verifyOtp).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/pages/AuthConfirm.test.tsx`
Expected: FAIL — module `./AuthConfirm` does not exist.

- [ ] **Step 3: Create the component**

Create `src/pages/AuthConfirm.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { supabase } from '../lib/supabase'
import { errorMessage } from '../lib/errors'
import { useAuth } from '../auth/AuthProvider'
import { Spinner } from '../components/Spinner'
import { authCard, authPage } from './authChrome'
import logoDark from '../assets/logo-dark.svg'

/**
 * Signup-confirmation landing. The emailed link carries ?token_hash=…&type=signup,
 * redeemed here exactly once via verifyOtp — which returns a session, so there is no
 * "confirm, then come back and sign in" round trip. An existing session is never
 * replaced: that covers a second click on the link and blocks session fixation via an
 * attacker-minted token (see the design spec's "Residual risk").
 */
export function AuthConfirm() {
  const { session, loading } = useAuth()
  const navigate = useNavigate()
  // One-shot: capture the token at mount; the redeem effect scrubs it from the URL.
  const [tokenHash] = useState(() => new URLSearchParams(window.location.search).get('token_hash'))
  const redeemed = useRef(false)
  const [verifyError, setVerifyError] = useState<string | null>(null)

  useEffect(() => {
    // Redeem exactly once: the token is single-use and StrictMode double-invokes
    // effects. Any existing session skips redemption entirely.
    if (loading || redeemed.current || session || !tokenHash) return
    redeemed.current = true
    window.history.replaceState(window.history.state, '', window.location.pathname)
    supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'signup' }).then(({ error: err }) => {
      if (err) setVerifyError(errorMessage(err))
    })
  }, [loading, session, tokenHash])

  useEffect(() => {
    if (session && redeemed.current) navigate('/', { replace: true })
  }, [session, navigate])

  if (loading) return <Spinner />

  if (session && !redeemed.current) {
    return (
      <div style={authPage}>
        <div style={authCard}>
          <img
            src={logoDark}
            alt="Magic Agenda"
            style={{ height: 110, display: 'block', margin: '0 0 6px' }}
          />
          <p style={{ margin: '0 0 18px', fontSize: 14, lineHeight: 1.5, opacity: 0.75 }}>
            You’re already signed in, so this confirmation link wasn’t used.
          </p>
          <Link to="/" style={{ color: '#a78bfa', fontWeight: 700, fontSize: 14 }}>
            Back to your board
          </Link>
        </div>
      </div>
    )
  }

  if (verifyError || (!session && !tokenHash)) {
    return (
      <div style={authPage}>
        <div style={authCard}>
          <img
            src={logoDark}
            alt="Magic Agenda"
            style={{ height: 110, display: 'block', margin: '0 0 6px' }}
          />
          <p style={{ margin: '0 0 18px', fontSize: 14, lineHeight: 1.5, opacity: 0.75 }}>
            This confirmation link is invalid or has expired. Try signing in — if your account is
            already confirmed it will work; otherwise sign up again for a fresh link.
          </p>
          <Link to="/login" style={{ color: '#a78bfa', fontWeight: 700, fontSize: 14 }}>
            Back to sign in
          </Link>
        </div>
      </div>
    )
  }

  return <Spinner label="Confirming your account…" />
}
```

- [ ] **Step 4: Register the public route**

In `src/App.tsx`, add the import alongside the other page imports:

```tsx
import { AuthConfirm } from './pages/AuthConfirm'
```

and the route next to the existing public auth routes (NOT wrapped in `ProtectedRoute`):

```tsx
<Route path="/auth/callback" element={<AuthCallback />} />
<Route path="/auth/confirm" element={<AuthConfirm />} />
<Route path="/auth/reset" element={<ResetPassword />} />
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/pages/AuthConfirm.test.tsx`
Expected: all 5 PASS.

- [ ] **Step 6: Commit**

```bash
git add src/pages/AuthConfirm.tsx src/pages/AuthConfirm.test.tsx src/App.tsx
git commit -m "feat: add /auth/confirm signup-confirmation landing (verifyOtp signs straight in)"
```

---

### Task 4: Login — emailRedirectTo + copy

**Files:**

- Modify: `src/pages/Login.tsx` (the `signup` branch of `submit`, lines 57-60 today)
- Modify: `src/pages/Login.test.tsx`

**Interfaces:**

- Consumes: route `/auth/confirm` from Task 3.
- Produces: signup confirmation emails whose `{{ .RedirectTo }}` resolves to
  `<origin>/auth/confirm` (required by the Task 8 templates).

- [ ] **Step 1: Add the failing test**

In `src/pages/Login.test.tsx`, promote `signUp` into the hoisted handle — replace the `h` block
and the supabase mock at the top of the file with:

```tsx
const h = vi.hoisted(() => ({
  resetPasswordForEmail: vi.fn(() => Promise.resolve({ data: {}, error: null })),
  signInWithOAuth: vi.fn(() => Promise.resolve({ error: null })),
  signUp: vi.fn(() => Promise.resolve({ data: {}, error: null })),
}))

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      resetPasswordForEmail: h.resetPasswordForEmail,
      signInWithPassword: vi.fn(() => Promise.resolve({ error: null })),
      signUp: h.signUp,
      signInWithOAuth: h.signInWithOAuth,
    },
  },
}))
```

then append the new test at the end of the file:

```tsx
test('signup points the confirmation email at /auth/confirm and drops "then sign in"', async () => {
  renderLogin()
  await userEvent.click(screen.getByRole('button', { name: 'Sign up' }))
  await userEvent.type(screen.getByPlaceholderText('you@example.com'), 'a@b.co')
  await userEvent.type(screen.getByPlaceholderText('Password'), 'Longenough123!')
  await userEvent.click(screen.getByRole('button', { name: 'Create account' }))
  expect(h.signUp).toHaveBeenCalledWith({
    email: 'a@b.co',
    password: 'Longenough123!',
    options: { emailRedirectTo: `${window.location.origin}/auth/confirm` },
  })
  // Confirmation now signs the user in — the old copy said "…, then sign in."
  expect(await screen.findByText('Check your email to confirm your account.')).toBeInTheDocument()
})
```

- [ ] **Step 2: Run the tests to verify the new one fails**

Run: `npx vitest run src/pages/Login.test.tsx`
Expected: the four existing tests PASS; the new one FAILS on the `toHaveBeenCalledWith`
(no `options`) and on the copy.

- [ ] **Step 3: Update the signup branch**

In `src/pages/Login.tsx`, replace the `mode === 'signup'` block inside `submit`:

```tsx
      if (mode === 'signup') {
        const { data, error: err } = await supabase.auth.signUp({
          email,
          password,
          // {{ .RedirectTo }} in the confirmation template resolves from this option —
          // it must stay in lockstep with the dashboard template (see the design spec).
          options: { emailRedirectTo: `${window.location.origin}/auth/confirm` },
        })
        if (err) throw err
        if (!data.session) setNotice('Check your email to confirm your account.')
      } else {
```

- [ ] **Step 4: Run the tests to verify all pass**

Run: `npx vitest run src/pages/Login.test.tsx`
Expected: all 5 PASS.

- [ ] **Step 5: Run the full suite, lint, format, build**

Run: `npm test && npm run lint && npm run format:check && npm run build`
Expected: all PASS (this is the last code task — leave the branch fully green).

- [ ] **Step 6: Commit**

```bash
git add src/pages/Login.tsx src/pages/Login.test.tsx
git commit -m "feat: send signup confirmations to /auth/confirm"
```

---

### Task 5: MANUAL GATE — email-provider precheck + redirect allow-list (Jerry, Supabase dashboard)

Safe to do now, before any merge: nothing here breaks anything. It MUST be done before the Task 8
templates go live, or `{{ .RedirectTo }}` for signups will fall back to the site URL.

**Why this step exists (settled 2026-07-25):** Supabase's
[2026-06-03 changelog](https://supabase.com/changelog/46599-changes-to-email-template-customisation-on-free-tier)
made auth email templates read-only for free-tier projects created on/after 2026-06-03 that use
the default email provider. This project (`mkhrdidosffuovqfooob`, created **2026-06-29**, custom
SMTP off) is affected — **Jerry confirmed the dashboard templates are read-only**. So custom SMTP
is a hard prerequisite for Task 8; a free SMTP provider tier keeps the whole stack at $0.
(Empirical footnote: delivery to non-team addresses _does_ work on the default provider here,
despite docs saying it's refused — editing, not delivery, is what gates this plan.)

- [ ] **Step 0: STOP and walk Jerry through the custom SMTP setup (required), then wait for
      confirmation it's done:**

> Set up free custom SMTP — Resend's free tier (100 emails/day) is the usual pick with Supabase;
> Brevo also works. With Resend:
>
> 1. Create a Resend account → **Domains → Add domain** → `magicagenda.app` → add the DNS
>    records Resend shows (DKIM/SPF) in the Cloudflare DNS dashboard → wait for **Verified**.
> 2. Resend → **API Keys** → create a key with sending access.
> 3. Supabase dashboard → **Project Settings → Authentication → SMTP Settings** → enable custom
>    SMTP: sender `no-reply@magicagenda.app` / name `Magic Agenda`, host `smtp.resend.com`,
>    port `465`, username `resend`, password = the API key. Save.
> 4. Supabase sets the auth email rate limit to 30/hour once custom SMTP is on — fine as-is.
> 5. Verify the templates became editable: **Authentication → Email Templates** → the "Reset
>    password" template should now accept edits (don't change it yet — that's Task 8, after
>    the merge).
> 6. Sanity check delivery: request a password reset and confirm the email arrives from the new
>    sender (the old-style link is fine — templates haven't changed yet).
> 7. While in the dashboard, note the **Email OTP expiration** value — the spec's cutover
>    window assumes ~1h.

- [ ] **Step 1: STOP and prompt Jerry with exactly this checklist, then wait for confirmation:**

> **Supabase dashboard → Authentication → URL Configuration → Redirect URLs.**
> Mirror how the existing `/auth/reset` entries are set up, adding for each origin already
> listed there (production, any Cloudflare Pages preview origins, and localhost):
>
> 1. `https://magicagenda.app/auth/confirm`
> 2. `http://localhost:5173/auth/confirm`
> 3. The `/auth/confirm` path on any other origin that already has an `/auth/reset` entry
>    (e.g. the Pages preview pattern, if present).
>
> While there, confirm `/auth/reset` entries are present for the same origins (they should be —
> the reset flow already uses `redirectTo`).

- [ ] **Step 2: Record Jerry's confirmation before proceeding to Task 6.**

---

### Task 6: Ship — docs, changelog, PR

- [ ] **Step 1: Invoke the `ship` skill** (it refreshes `AGENTS.md`/`README.md`/`ROADMAP.md` via
      `docs-updater`, writes the `CHANGELOG.md` entry for the exact version this merge will mint via
      `scripts/next-version.mjs`, runs `format:check` + `lint` + `tsc -b`, pushes
      `feat/pkce-auth-flow`, and opens the PR).

Notes for the changelog/docs pass:

- Changelog entry: security fix — PKCE + explicit `token_hash` redemption for email flows; closes
  the 2026-07-25 review's Finding 1 (session fixation via implicit-flow URL tokens). New
  `/auth/confirm` page; signup confirmation now signs the user straight in.
- `AGENTS.md`'s pages list gains `AuthConfirm`; do not add auth internals there beyond what the
  existing prose style carries.

- [ ] **Step 2: Wait for all required checks green** (`Format` / `Test` / `Build` / `Functions` /
      `Agents` / `Changelog` + CodeQL). Fix anything red and push again.

---

### Task 7: MANUAL GATE — merge timing (Jerry decides)

Merging starts the clean-cut window: the moment Cloudflare Pages deploys `main`, old-format email
links stop signing users in, until the Task 8 templates are updated. The window should be minutes
— merge only when Jerry is ready to do Task 8 immediately after.

- [ ] **Step 1: STOP and prompt Jerry with exactly this, then wait:**

> The PR is green. Merging deploys the clean cut: after Pages finishes deploying, existing email
> links stop signing users in until you update the two templates (next gate — takes ~2 minutes in
> the dashboard). Old reset links will show "invalid or expired" (users just request a new one);
> old signup links still confirm the account server-side, the user lands at `/login` and signs in
> normally.
>
> **Ready to merge now and do the template edits right after?** (If yes, I'll merge; if you'd
> rather merge yourself, say so.)

- [ ] **Step 2: On confirmation, merge the PR** (self-merge is allowed once green):

```bash
gh pr merge --squash --delete-branch
```

- [ ] **Step 3: Confirm the deploy landed** — wait a few minutes for Cloudflare Pages to build
      `main`, then verify the security fix is live:

> Open `https://magicagenda.app/#access_token=x&refresh_token=x&expires_in=3600&token_type=bearer`
> in a private window → it must land on `/login` with **no** session established and the fragment
> untouched. (Before this change, auth-js would have tried to adopt the tokens and scrubbed the
> fragment.)

---

### Task 8: MANUAL GATE — email templates (Jerry, Supabase dashboard, immediately after deploy)

- [ ] **Step 1: STOP and prompt Jerry with exactly this checklist, then wait:**

> **Supabase dashboard → Authentication → Email Templates.** In each template, replace the
> `{{ .ConfirmationURL }}` link `href` with the new URL (leave the surrounding copy/markup as-is;
> ROADMAP 5.7 restyles these later):
>
> 1. **Reset password** template — link `href` becomes:
>    `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=recovery`
> 2. **Confirm signup** template — link `href` becomes:
>    `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=signup`
>
> Save both. **Rollback** (if anything goes wrong post-verification): restore
> `{{ .ConfirmationURL }}` in both templates and revert the merge commit on `main` via a revert
> PR — both are fast, which is what makes the clean cut acceptable.

- [ ] **Step 2: Record Jerry's confirmation before proceeding to Task 9.**

---

### Task 9: MANUAL GATE — post-deploy verification (Jerry, mandatory)

Unit tests mock the SDK; the templates are the highest-risk part of this change and are only
exercised by a real send.

- [ ] **Step 1: STOP and prompt Jerry with exactly this checklist; the change is not done until
      every item is confirmed:**

> On production (`https://magicagenda.app`):
>
> 1. Sign up with a throwaway address → the confirmation link signs you in and lands on the
>    board (no "now sign in" round trip). _(Emails now come via the custom SMTP configured in
>    Task 5 — 30/hour, so the checklist won't hit rate limits.)_
> 2. Request a password reset → the link opens `/auth/reset`, a new password can be set, and it
>    works on the next sign-in.
> 3. Mid-reset reload: open a reset link, reload the page before submitting → the password form
>    is still shown (not the "invalid or expired" card).
> 4. Google OAuth still completes.
> 5. Sanity: `https://magicagenda.app/#access_token=<anything>` does not establish a session.
>
> If 1 or 2 fails, the template edit is the first suspect — check the link in the received email
> has the shape `…/auth/confirm?token_hash=…&type=signup` (or `…/auth/reset?…&type=recovery`),
> then see the rollback note in Task 8.

- [ ] **Step 2: On full confirmation, the spec's Finding 1 is closed.** Remind Jerry of the two
      follow-ups the spec filed (reconcile `supabase/config.toml` with production; then optionally
      move templates into code) so they get tracked, not lost.

---

## Self-review notes (kept for the record)

- Spec coverage: client config (T1), ResetPassword rework incl. reload/re-entry/refusal (T2),
  AuthConfirm + public route (T3), Login `emailRedirectTo` + copy (T4), allow-list (T5, manual),
  templates (T8, manual), manual verification incl. mid-reset reload and fragment sanity (T9),
  rollback (in T8's prompt), follow-ups surfaced (T9). `AuthProvider`/`ProtectedRoute`/
  `AuthCallback` untouched per the revised spec.
- The `PASSWORD_RECOVERY` → flag path is already covered by `src/auth/AuthProvider.test.tsx`
  ("PASSWORD_RECOVERY raises the recovery flag…"), which captures the `onAuthStateChange`
  callback — the production mechanism this design keeps relying on. Page tests therefore mock
  `useAuth` state directly, matching the repo's existing pattern.
- StrictMode-once tests rely on Vitest using React's dev build (it does), where `<StrictMode>`
  double-invokes effects while preserving refs — exactly the production-dev behavior the ref
  guard exists for.
