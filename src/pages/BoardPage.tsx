import { useNavigate } from 'react-router'
import { useAuth } from '../auth/AuthProvider'
import { ThemeProvider } from '../theme/ThemeProvider'
import { Board } from '../components/Board'
import { Spinner } from '../components/Spinner'
import { ErrorScreen } from '../components/ErrorScreen'
import { Toast } from '../components/Toast'
import { useTasks } from '../data/useTasks'
import { useSettingsContext } from '../data/SettingsProvider'
import { useBoardDirectoryContext, useBoardSession } from '../board/BoardDirectoryProvider'
import { readLastUserId } from '../lib/lastUser'
import { OfflineContext } from '../data/offlineContext'
import { TaskBoardContext } from '../data/taskBoardContext'

/** The signed-in board: owns the Supabase-backed task state, reads session-wide settings. */
export function BoardPage() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const userId = user?.id ?? readLastUserId()
  // `userId` may resolve from the stale last-known id with no live session behind it (the
  // offline-boot fallback); `useTasks` needs that distinction to know a write is safe.
  // The selected Board comes from the session-wide directory above <Routes>. Until it resolves
  // `selectedBoardId` is null and `useTasks` deliberately loads nothing: an unfiltered load would
  // fetch every task this account owns across every Board.
  const { selectedBoardId, loading: boardsLoading } = useBoardDirectoryContext()
  // Default View is a Membership Preference: it describes how this account experiences THIS board.
  // `settings.defaultView` remains as the fallback until that column is dropped in cleanup.
  const { board } = useBoardSession()
  const t = useTasks(userId, selectedBoardId ?? '', Boolean(user))
  const { settings, loading: settingsLoading, saveTheme } = useSettingsContext()

  // Gate on the resolved user id, not on `user`/`session`: ProtectedRoute has already made the
  // auth decision. On the offline-boot fallback (no session, offline, snapshot present) there is
  // no `user`, but `userId` (session id, else the last-known id) is what the board actually needs.
  // `boardsLoading` joins the gate rather than being handled below it: without it the board renders
  // its empty state for a moment while the directory resolves, which is indistinguishable from a
  // genuinely empty board and reads as data loss.
  if (!userId || settingsLoading || !settings || boardsLoading) return <Spinner />

  return (
    <ThemeProvider initial={settings.theme} onThemeChange={(theme) => void saveTheme(theme)}>
      {t.error && t.tasks.length === 0 ? (
        <ErrorScreen message={t.error} onRetry={() => void t.reload()} />
      ) : t.loading && t.tasks.length === 0 ? (
        <Spinner label="Loading your board…" />
      ) : (
        <>
          <OfflineContext.Provider value={{ readOnly: t.offline, savedAt: t.savedAt }}>
            <TaskBoardContext.Provider value={t}>
              <Board
                initialView={board?.defaultView ?? settings.defaultView}
                weekStart={settings.weekStart}
                onSignOut={() => void signOut()}
                onOpenSettings={() => void navigate('/settings')}
              />
            </TaskBoardContext.Provider>
          </OfflineContext.Provider>
          {t.error && <Toast message={t.error} onDismiss={t.clearError} />}
        </>
      )}
    </ThemeProvider>
  )
}
