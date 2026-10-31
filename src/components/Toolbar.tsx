import { useTheme } from '../theme/ThemeProvider'
import {
  scrollbars,
  toolbarChrome,
  TOOLBAR_CONTROL_FILL_ACTIVE,
  TOOLBAR_CONTROL_HEIGHT,
} from '../theme/chrome'
import { useIsMobile } from '../lib/useMediaQuery'
import { BoardSwitcher } from './BoardSwitcher'
import { ViewSwitcher, type ViewOption } from './ViewSwitcher'
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
  overdueCount?: number
  addDisabled?: boolean
  /** Opens the phone's search and filter controls (#564). Desktop always shows them. */
  onToggleControls?: () => void
  controlsOpen?: boolean
  /** The element the controls button opens, for `aria-controls`. */
  controlsPanelId?: string
  /** Whether any filter is narrowing the board, which the controls button must show. */
  filterActive?: boolean
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
  overdueCount,
  addDisabled,
  onToggleControls,
  controlsOpen = false,
  controlsPanelId,
  filterActive = false,
}: ToolbarProps) {
  const { theme, conf } = useTheme()
  const isMobile = useIsMobile()
  const c = toolbarChrome(theme, conf)

  if (isMobile) {
    // Phone layout (#564): two rows, so the board gets the height. Search, filters, Pinned, and
    // Select sit behind the controls button, and Sign out lives in Settings. Row one holds what
    // changes the whole screen, row two the Board, the date, and New task.
    // flexWrap must be 'nowrap': c.toolbar carries 'wrap', and a wrappable column flex
    // container sizes its line to the widest row's content, blowing every row past the viewport.
    return (
      <header
        style={{
          ...c.toolbar,
          flexDirection: 'column',
          flexWrap: 'nowrap',
          alignItems: 'stretch',
          gap: '6px',
          padding: '7px 10px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <h1 style={{ margin: 0, flex: 'none' }}>
            {/* The logo's tile only: the box is as wide as the tile, and cover keeps the height. */}
            <img
              src={logoDark}
              alt="Magic Agenda"
              style={{
                height: TOOLBAR_CONTROL_HEIGHT,
                width: 30,
                display: 'block',
                objectFit: 'cover',
                objectPosition: 'left center',
              }}
            />
          </h1>
          {/* Fits from 360px up; narrower than that it scrolls rather than push the page wider. */}
          <div
            style={{
              flex: '0 1 auto',
              minWidth: 0,
              marginRight: 'auto',
              overflowX: 'auto',
              ...scrollbars(conf),
            }}
          >
            <ViewSwitcher views={views} view={view} onChange={onChangeView} compact />
          </div>
          {onToggleControls && (
            <button
              type="button"
              onClick={onToggleControls}
              aria-expanded={controlsOpen}
              aria-controls={controlsOpen ? controlsPanelId : undefined}
              aria-label={`Search and filters${filterActive ? ', filters active' : ''}`}
              title="Search and filters"
              style={{
                ...c.iconBtn,
                flex: 'none',
                position: 'relative',
                ...(controlsOpen && { background: TOOLBAR_CONTROL_FILL_ACTIVE }),
              }}
            >
              <svg
                aria-hidden="true"
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              >
                <circle cx="7" cy="7" r="4.5" />
                <path d="M10.5 10.5 14 14" />
              </svg>
              {/* A filtered month must not read as an empty one. The name says so to assistive
                  technology, which is why the dot itself is hidden from it. */}
              {filterActive && (
                <span
                  aria-hidden="true"
                  data-testid="filter-marker"
                  style={{
                    position: 'absolute',
                    top: -3,
                    right: -3,
                    width: 11,
                    height: 11,
                    boxSizing: 'border-box',
                    borderRadius: '50%',
                    background: conf.accent,
                    border: `2px solid ${conf.toolbarFg}`,
                  }}
                />
              )}
            </button>
          )}
          {onOpenSettings && (
            <button
              type="button"
              onClick={onOpenSettings}
              aria-label="Settings"
              title="Settings"
              style={{ ...c.iconBtn, flex: 'none' }}
            >
              ⚙
            </button>
          )}
        </div>
        {/* Wraps rather than overflows: the Board creator takes a line of its own while it is open,
            and a window narrower than a phone gets a third row instead of a wider page. */}
        <div
          style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4, minWidth: 0 }}
        >
          <BoardSwitcher />
          {showNav && (
            <div style={{ ...c.navGroup, gap: 4 }}>
              <button type="button" onClick={onPrev} style={{ ...c.navBtn, width: 30 }}>
                ‹
              </button>
              {/* Two lines at most: "September" over "2026", within the height of the row. */}
              <div style={{ ...c.monthLabel, flex: 'none', width: 68, fontSize: 12, minWidth: 0 }}>
                {navLabel}
              </div>
              <button type="button" onClick={onNext} style={{ ...c.navBtn, width: 30 }}>
                ›
              </button>
              {/* Tight enough that a two-digit overdue count stays on this row at 360px. */}
              <button
                type="button"
                onClick={onToday}
                style={{ ...c.todayBtn, padding: '0 7px', fontSize: 12 }}
              >
                Today{overdueCount ? ` (${overdueCount})` : ''}
              </button>
            </div>
          )}
          <button
            type="button"
            onClick={onAddInbox}
            disabled={addDisabled}
            aria-label="+ New task"
            title={addDisabled ? 'Offline — changes are disabled' : 'New task'}
            style={{
              ...c.addBtn,
              flex: 'none',
              width: TOOLBAR_CONTROL_HEIGHT,
              padding: 0,
              fontSize: 20,
              marginLeft: 'auto',
            }}
          >
            +
          </button>
        </div>
      </header>
    )
  }

  return (
    <header style={c.toolbar}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, minWidth: 0 }}>
        <h1 style={{ margin: 0, flex: 'none' }}>
          <img src={logoDark} alt="Magic Agenda" style={{ height: 80, display: 'block' }} />
        </h1>
        <BoardSwitcher />
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
              Today{overdueCount ? ` (${overdueCount})` : ''}
            </button>
          </div>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        {onOpenSettings && (
          <button
            type="button"
            onClick={onOpenSettings}
            aria-label="Settings"
            title="Settings"
            style={c.iconBtn}
          >
            ⚙
          </button>
        )}
        <button
          type="button"
          onClick={onAddInbox}
          disabled={addDisabled}
          title={addDisabled ? 'Offline — changes are disabled' : undefined}
          style={c.addBtn}
        >
          + New task
        </button>
        {onSignOut && (
          <button type="button" onClick={onSignOut} style={c.todayBtn} title="Sign out">
            Sign out
          </button>
        )}
      </div>
    </header>
  )
}
