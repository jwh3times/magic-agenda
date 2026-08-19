import { type CSSProperties, type ReactNode } from 'react'
import { Link } from 'react-router'
import { useAuth } from '../auth/AuthProvider'
import { ThemeProvider, useTheme } from '../theme/ThemeProvider'
import { ThemeSwitcher } from '../components/ThemeSwitcher'
import { DangerZone } from '../components/DangerZone'
import { DataSection } from '../components/DataSection'
import { BoardsSection } from '../components/BoardsSection'
import { DatesSection } from '../components/DatesSection'
import { LabelsSection } from '../components/LabelsSection'
import { Spinner } from '../components/Spinner'
import { useSettingsContext } from '../data/SettingsProvider'
import { useIsMobile } from '../lib/useMediaQuery'
import { readLastUserId } from '../lib/lastUser'
import { useBoardDirectoryContext, useBoardSession } from '../board/BoardDirectoryProvider'
import { DEFAULT_VIEW } from '../board/selection'
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

const SECTIONS: SettingsSection[] = [
  { id: 'appearance', title: 'Appearance', render: (ctx) => <AppearanceSection {...ctx} /> },
  { id: 'dates', title: 'Dates', render: () => <DatesSection /> },
  { id: 'boards', title: 'Boards', render: () => <BoardsSection /> },
  { id: 'labels', title: 'Labels', render: () => <LabelsSection /> },
  { id: 'data', title: 'Data', render: () => <DataSection /> },
  { id: 'danger', title: 'Danger zone', render: () => <DangerZone /> },
]

/** The protected /settings route: reads the session-wide settings, seeds the theme. */
export function SettingsPage() {
  const { user } = useAuth()
  const { settings, loading, saveTheme } = useSettingsContext()
  const { setDefaultView } = useBoardDirectoryContext()
  const { board } = useBoardSession()
  // Same reasoning as BoardPage: ProtectedRoute has already made the auth decision, and on the
  // offline-boot fallback (no session, offline, snapshot present) there is no `user`, but this
  // page still needs a resolved id — `readLastUserId()` is what `SettingsProvider` used to fetch
  // `settings` in the first place.
  const userId = user?.id ?? readLastUserId()

  if (!userId || loading || !settings) return <Spinner />

  // Default View is a Membership Preference, and now only that. It used to be written to
  // `user_settings.default_view` as well, so the then-deployed client kept reading a value it
  // understood; that dual write is gone with the column, leaving one source of truth.
  const membershipView = board?.defaultView ?? DEFAULT_VIEW
  const changeView = (view: ViewName) => {
    if (board) void setDefaultView(board.id, view)
  }

  return (
    <ThemeProvider initial={settings.theme} onThemeChange={saveTheme}>
      <SettingsShell defaultView={membershipView} onChangeView={changeView} />
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

        <main style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
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
        </main>

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
          <option value="kanban">Board</option>
        </select>
      </div>
    </div>
  )
}
