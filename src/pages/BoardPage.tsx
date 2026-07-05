import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { ThemeProvider } from '../theme/ThemeProvider'
import { Board } from '../components/Board'
import { Spinner } from '../components/Spinner'
import { ErrorScreen } from '../components/ErrorScreen'
import { Toast } from '../components/Toast'
import { useTasks } from '../data/useTasks'
import { useSettings } from '../data/useSettings'

/** The signed-in board: owns the Supabase-backed task + settings state, seeds the theme. */
export function BoardPage() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const userId = user?.id ?? ''
  const t = useTasks(userId)
  const { settings, loading: settingsLoading, saveTheme } = useSettings(userId)

  if (!user || settingsLoading || !settings) return <Spinner />

  return (
    <ThemeProvider initial={settings.theme} onThemeChange={saveTheme}>
      {t.error && t.tasks.length === 0 ? (
        <ErrorScreen message={t.error} onRetry={t.reload} />
      ) : t.loading && t.tasks.length === 0 ? (
        <Spinner label="Loading your board…" />
      ) : (
        <>
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
          />
          {t.error && <Toast message={t.error} onDismiss={t.clearError} />}
        </>
      )}
    </ThemeProvider>
  )
}
