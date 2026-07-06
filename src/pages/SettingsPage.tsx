import { type CSSProperties, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { ThemeProvider, useTheme } from '../theme/ThemeProvider'
import { ThemeSwitcher } from '../components/ThemeSwitcher'
import { DangerZone } from '../components/DangerZone'
import { DataSection } from '../components/DataSection'
import { Spinner } from '../components/Spinner'
import { useSettings } from '../data/useSettings'
import { useIsMobile } from '../lib/useMediaQuery'
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

// Later features append here (Danger zone, export/import, week-start/timezone, labels…).
const SECTIONS: SettingsSection[] = [
  { id: 'appearance', title: 'Appearance', render: (ctx) => <AppearanceSection {...ctx} /> },
  { id: 'data', title: 'Data', render: () => <DataSection /> },
  { id: 'danger', title: 'Danger zone', render: () => <DangerZone /> },
]

/** The protected /settings route: owns its own settings state + theme, like BoardPage. */
export function SettingsPage() {
  const { user } = useAuth()
  const userId = user?.id ?? ''
  const { settings, loading, saveTheme, saveView } = useSettings(userId)

  if (!user || loading || !settings) return <Spinner />

  return (
    <ThemeProvider initial={settings.theme} onThemeChange={saveTheme}>
      <SettingsShell defaultView={settings.defaultView} onChangeView={saveView} />
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
