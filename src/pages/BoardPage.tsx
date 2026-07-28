import { useNavigate } from 'react-router'
import { useAuth } from '../auth/AuthProvider'
import { ThemeProvider } from '../theme/ThemeProvider'
import { Board } from '../components/Board'
import { Spinner } from '../components/Spinner'
import { ErrorScreen } from '../components/ErrorScreen'
import { Toast } from '../components/Toast'
import { useTasks } from '../data/useTasks'
import { useSettingsContext } from '../data/SettingsProvider'
import { readLastUserId } from '../lib/lastUser'
import { OfflineContext } from '../data/offlineContext'

/** The signed-in board: owns the Supabase-backed task state, reads session-wide settings. */
export function BoardPage() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const userId = user?.id ?? readLastUserId()
  // `userId` may resolve from the stale last-known id with no live session behind it (the
  // offline-boot fallback); `useTasks` needs that distinction to know a write is safe.
  const t = useTasks(userId, Boolean(user))
  const { settings, loading: settingsLoading, saveTheme } = useSettingsContext()

  // Gate on the resolved user id, not on `user`/`session`: ProtectedRoute has already made the
  // auth decision. On the offline-boot fallback (no session, offline, snapshot present) there is
  // no `user`, but `userId` (session id, else the last-known id) is what the board actually needs.
  if (!userId || settingsLoading || !settings) return <Spinner />

  return (
    <ThemeProvider initial={settings.theme} onThemeChange={saveTheme}>
      {t.error && t.tasks.length === 0 ? (
        <ErrorScreen message={t.error} onRetry={t.reload} />
      ) : t.loading && t.tasks.length === 0 ? (
        <Spinner label="Loading your board…" />
      ) : (
        <>
          <OfflineContext.Provider value={{ readOnly: t.offline, savedAt: t.savedAt }}>
            <Board
              tasks={t.tasks}
              setTasks={t.setTasks}
              onCreate={t.createTask}
              onUpdate={t.updateTask}
              onDelete={t.removeTask}
              onToggleDone={t.toggleDone}
              persistReorder={t.persistReorder}
              getTemplate={t.getTemplate}
              updateSeries={t.updateSeries}
              deleteOccurrence={t.deleteOccurrence}
              deleteSeriesFuture={t.deleteSeriesFuture}
              initialView={settings.defaultView}
              onSignOut={signOut}
              onOpenSettings={() => navigate('/settings')}
              rollForward={t.rollForward}
            />
          </OfflineContext.Provider>
          {t.error && <Toast message={t.error} onDismiss={t.clearError} />}
        </>
      )}
    </ThemeProvider>
  )
}
