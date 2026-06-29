import { useTheme } from '../theme/ThemeProvider'
import { toolbarChrome } from '../theme/chrome'
import { ViewSwitcher, type ViewOption } from './ViewSwitcher'
import { ThemeSwitcher } from './ThemeSwitcher'
import type { ViewName } from '../types/task'

export interface ToolbarProps {
  views: ViewOption[]
  view: ViewName
  onChangeView: (v: ViewName) => void
  isCalendar: boolean
  monthName: string
  year: number
  onPrev: () => void
  onNext: () => void
  onToday: () => void
  onAddInbox: () => void
}

export function Toolbar({
  views,
  view,
  onChangeView,
  isCalendar,
  monthName,
  year,
  onPrev,
  onNext,
  onToday,
  onAddInbox,
}: ToolbarProps) {
  const { theme, conf } = useTheme()
  const c = toolbarChrome(theme, conf)
  return (
    <div style={c.toolbar}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, minWidth: 0 }}>
        <div style={c.brand}>{conf.appName}</div>
        <ViewSwitcher views={views} view={view} onChange={onChangeView} />
        {isCalendar && (
          <div style={c.navGroup}>
            <button type="button" onClick={onPrev} style={c.navBtn}>
              ‹
            </button>
            <div style={c.monthLabel}>
              {monthName} <span style={c.yearLabel}>{year}</span>
            </div>
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
      </div>
    </div>
  )
}
