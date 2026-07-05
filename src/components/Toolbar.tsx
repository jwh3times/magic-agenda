import { useTheme } from '../theme/ThemeProvider'
import { toolbarChrome } from '../theme/chrome'
import { useIsMobile } from '../lib/useMediaQuery'
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
  onOpenSettings?: () => void
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
  onOpenSettings,
}: ToolbarProps) {
  const { theme, conf } = useTheme()
  const isMobile = useIsMobile()
  const c = toolbarChrome(theme, conf)

  if (isMobile) {
    // Phone layout: three stacked rows — brand + actions, switchers (side-scrollable), nav.
    // flexWrap must be 'nowrap': c.toolbar carries 'wrap', and a wrappable column flex
    // container sizes its line to the widest row's content, blowing every row past the
    // viewport (and keeping the switcher row's overflow-x from ever engaging).
    return (
      <div
        style={{
          ...c.toolbar,
          flexDirection: 'column',
          flexWrap: 'nowrap',
          alignItems: 'stretch',
          gap: '9px',
          padding: '9px 10px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <img
            src={logoDark}
            alt="Magic Agenda"
            style={{
              height: 44,
              display: 'block',
              // Shrinkable (unlike the buttons) so the row always fits the viewport.
              flex: '0 1 auto',
              minWidth: 0,
              objectFit: 'contain',
              objectPosition: 'left center',
            }}
          />
          <div style={{ flex: 1 }} />
          <button type="button" onClick={onAddInbox} style={{ ...c.addBtn, flex: 'none' }}>
            + New task
          </button>
          {onOpenSettings && (
            <button
              type="button"
              onClick={onOpenSettings}
              aria-label="Settings"
              title="Settings"
              style={{ ...c.todayBtn, flex: 'none' }}
            >
              ⚙
            </button>
          )}
          {onSignOut && (
            <button
              type="button"
              onClick={onSignOut}
              style={{ ...c.todayBtn, flex: 'none', whiteSpace: 'nowrap' }}
              title="Sign out"
            >
              Sign out
            </button>
          )}
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
            overflowX: 'auto',
          }}
        >
          <ViewSwitcher views={views} view={view} onChange={onChangeView} />
          <ThemeSwitcher />
        </div>
        {showNav && (
          <div style={{ ...c.navGroup, justifyContent: 'center' }}>
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
    )
  }

  return (
    <div style={c.toolbar}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, minWidth: 0 }}>
        <img
          src={logoDark}
          alt="Magic Agenda"
          style={{ height: 80, display: 'block', flex: 'none' }}
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
        {onOpenSettings && (
          <button
            type="button"
            onClick={onOpenSettings}
            aria-label="Settings"
            title="Settings"
            style={c.todayBtn}
          >
            ⚙
          </button>
        )}
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
