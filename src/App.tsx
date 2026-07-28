import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import { AuthProvider, useAuth } from './auth/AuthProvider'
import { ProtectedRoute } from './auth/ProtectedRoute'
import { SettingsProvider } from './data/SettingsProvider'
import { TodayProvider } from './data/TodayProvider'
import { Spinner } from './components/Spinner'
import { UpdatePrompt } from './components/UpdatePrompt'
import { Login } from './pages/Login'
import { AuthCallback } from './pages/AuthCallback'
import { AuthConfirm } from './pages/AuthConfirm'
import { ResetPassword } from './pages/ResetPassword'
import { Privacy } from './pages/Privacy'
import { Terms } from './pages/Terms'
import { Landing } from './pages/Landing'
import { useOnline } from './lib/useOnline'
import { hasBoardSnapshot } from './data/snapshot'
import { readLastUserId } from './lib/lastUser'

// The board pulls in dnd-kit, every view, the editor, and the Supabase data layer —
// lazy-load it so the login/auth path stays a small initial bundle.
const BoardPage = lazy(() => import('./pages/BoardPage').then((m) => ({ default: m.BoardPage })))
const SettingsPage = lazy(() =>
  import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })),
)

/**
 * `/` serves two audiences: signed-out visitors get the marketing page, signed-in users get their
 * board at the same URL (no URL migration, no broken bookmarks).
 *
 * This deliberately does NOT use `ProtectedRoute`, but it must mirror TWO of that component's
 * guards, in the same relative order, or this becomes a second copy that silently drifts:
 *
 * 1. Password recovery: a session created by a recovery link has to set a new password before
 *    reaching the board. A plain `session ? <BoardPage/> : <Landing/>` silently drops that and is
 *    a session-fixation regression (see v1.2.19).
 * 2. Offline fallback: no session, offline, and a board snapshot for the last signed-in user ->
 *    render the board read-only instead of the marketing page (see `ProtectedRoute`'s comment for
 *    why). Gated on `!passwordRecovery` too, so a lingering recovery flag from an interrupted
 *    flow can't ride this branch past the guard above.
 *
 * `HomeRoute.test.tsx` pins both.
 *
 * `loading` resolves from localStorage with no network round trip, so the spinner is imperceptible.
 */
function HomeRoute() {
  const { session, loading, passwordRecovery } = useAuth()
  const online = useOnline()
  if (loading) return <Spinner />
  if (!session) {
    if (!online && !passwordRecovery && hasBoardSnapshot(readLastUserId())) {
      return (
        <Suspense fallback={<Spinner label="Loading…" />}>
          <BoardPage />
        </Suspense>
      )
    }
    return <Landing />
  }
  if (passwordRecovery) return <Navigate to="/auth/reset" replace />
  return (
    <Suspense fallback={<Spinner label="Loading…" />}>
      <BoardPage />
    </Suspense>
  )
}

export default function App() {
  return (
    <AuthProvider>
      {/* Above <Routes>: `/` and `/settings` are mutually exclusive, so a per-page hook refetched
          settings and rebuilt the realtime channel on every navigation between them. */}
      <SettingsProvider>
        <TodayProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/auth/callback" element={<AuthCallback />} />
              <Route path="/auth/confirm" element={<AuthConfirm />} />
              <Route path="/auth/reset" element={<ResetPassword />} />
              <Route path="/privacy" element={<Privacy />} />
              <Route path="/terms" element={<Terms />} />
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
              <Route path="/" element={<HomeRoute />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </BrowserRouter>
        </TodayProvider>
        <UpdatePrompt />
      </SettingsProvider>
    </AuthProvider>
  )
}
