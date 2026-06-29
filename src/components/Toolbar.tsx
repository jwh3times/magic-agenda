import { useTheme } from '../theme/ThemeProvider'
import { toolbarChrome } from '../theme/chrome'
import { ViewSwitcher, type ViewOption } from './ViewSwitcher'
import { ThemeSwitcher } from './ThemeSwitcher'
import logoDark from '../assets/logo-dark.svg'
import type { ViewName } from '../types/task'

export interface ToolbarProps {
  views: ViewOption[]
  view: ViewName
  onChangeView: (v: ViewName) => void
  showNav: boolean
  navLabel: string
  onPrev: () => void
  onNext: () => void
  onToday: () => void
  onAddInbox: () => void
  onSignOut?: () => void
}

export function Toolbar({
  views,
  view,
  onChangeView,
  showNav,
  navLabel,
  onPrev,
  onNext,
  onToday,
  onAddInbox,
  onSignOut,
}: ToolbarProps) {
  const { theme, conf } = useTheme()
  const c = toolbarChrome(theme, conf)
  return (
    <div style={c.toolbar}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, minWidth: 0 }}>
        <img
          src={logoDark}
          alt="Magic Agenda"
          style={{ height: 30, display: 'block', flex: 'none' }}
        />
        <ViewSwitcher views={views} view={view} onChange={onChangeView} />
        {showNav && (
          <div style={c.navGroup}>
            <button type="button" onClick={onPrev} style={c.navBtn}>
              ‹
            </button>
            <div style={c.monthLabel}>{navLabel}</div>
            <button type="button" onClick={onNext} style={c.navBtn}>
              ›
            </button>
            <button type="button" onClick={onToday} style={c.todayBtn}>
              Today
            </button>
          </div>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <ThemeSwitcher />
        <button type="button" onClick={onAddInbox} style={c.addBtn}>
          + New task
        </button>
        {onSignOut && (
          <button type="button" onClick={onSignOut} style={c.todayBtn} title="Sign out">
            Sign out
          </button>
        )}
      </div>
    </div>
  )
}
