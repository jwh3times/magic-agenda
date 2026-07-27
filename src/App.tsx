import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import { AuthProvider, useAuth } from './auth/AuthProvider'
import { ProtectedRoute } from './auth/ProtectedRoute'
import { SettingsProvider } from './data/SettingsProvider'
import { Spinner } from './components/Spinner'
import { Login } from './pages/Login'
import { AuthCallback } from './pages/AuthCallback'
import { AuthConfirm } from './pages/AuthConfirm'
import { ResetPassword } from './pages/ResetPassword'
import { Privacy } from './pages/Privacy'
import { Terms } from './pages/Terms'
import { Landing } from './pages/Landing'

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
 * This deliberately does NOT use `ProtectedRoute`, but it must keep that component's
 * password-recovery guard: a session created by a recovery link has to set a new password before
 * reaching the board. A plain `session ? <BoardPage/> : <Landing/>` silently drops that and is a
 * session-fixation regression (see v1.2.19). `HomeRoute.test.tsx` pins it.
 *
 * `loading` resolves from localStorage with no network round trip, so the spinner is imperceptible.
 */
function HomeRoute() {
  const { session, loading, passwordRecovery } = useAuth()
  if (loading) return <Spinner />
  if (!session) return <Landing />
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
      </SettingsProvider>
    </AuthProvider>
  )
}
