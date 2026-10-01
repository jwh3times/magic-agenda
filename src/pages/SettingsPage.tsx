import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Link } from 'react-router'
import { useAuth } from '../auth/AuthProvider'
import { ThemeProvider, useTheme } from '../theme/ThemeProvider'
import { ThemeSwitcher } from '../components/ThemeSwitcher'
import { LinkButton, Select } from '../components/controls'
import { navItemStyle } from '../theme/controls'
import { DangerZone } from '../components/DangerZone'
import { DataSection } from '../components/DataSection'
import { BoardsSection } from '../components/BoardsSection'
import { DatesSection } from '../components/DatesSection'
import { KeyboardSection } from '../components/KeyboardSection'
import { NotificationsSection } from '../components/NotificationsSection'
import { ProfileSection } from '../components/ProfileSection'
import { LabelsSection } from '../components/LabelsSection'
import { HistorySection } from '../components/HistorySection'
import { TwoFactorSection } from '../components/TwoFactorSection'
import { Spinner } from '../components/Spinner'
import { useSettingsContext } from '../data/SettingsProvider'
import { useIsMobile } from '../lib/useMediaQuery'
import { currentSection } from '../lib/sectionSpy'
import { readLastUserId } from '../lib/lastUser'
import { useRole } from '../access/useRole'
import { useBoardSharing } from '../access/useBoardSharing'
import { useBoardDirectoryContext, useBoardSession } from '../board/BoardDirectoryProvider'
import { DEFAULT_VIEW } from '../board/selection'
import type { ViewName } from '../types/task'

export interface SectionContext {
  defaultView: ViewName
  onChangeView: (v: ViewName) => void
}

/** What a section may read beyond the view preference: session-scoped rollout gates. */
export interface RenderContext extends SectionContext {
  /** The `board-sharing` feature flag (#438): shows Board membership administration. */
  boardSharing: boolean
}

export interface SettingsSection {
  id: string
  title: string
  render: (ctx: RenderContext) => ReactNode
}

const SECTIONS: SettingsSection[] = [
  { id: 'profile', title: 'Profile', render: () => <ProfileSection /> },
  { id: 'appearance', title: 'Appearance', render: (ctx) => <AppearanceSection {...ctx} /> },
  { id: 'dates', title: 'Dates', render: () => <DatesSection /> },
  { id: 'keyboard', title: 'Keyboard shortcuts', render: () => <KeyboardSection /> },
  { id: 'notifications', title: 'Notifications', render: () => <NotificationsSection /> },
  {
    id: 'boards',
    title: 'Boards',
    render: (ctx) => <BoardsSection boardSharing={ctx.boardSharing} />,
  },
  { id: 'labels', title: 'Labels', render: () => <LabelsSection /> },
  { id: 'history', title: 'History', render: () => <HistorySection /> },
  { id: 'data', title: 'Data', render: () => <DataSection /> },
  { id: 'security', title: 'Two-factor authentication', render: () => <TwoFactorSection /> },
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
  const { theme, conf } = useTheme()
  const isMobile = useIsMobile()
  const { isAdmin } = useRole()
  const boardSharing = useBoardSharing()
  const [active, jumpTo] = useActiveSection(SECTION_IDS, !isMobile)

  const card: CSSProperties = {
    background: conf.cellBg,
    border: conf.cellBorder,
    borderRadius: conf.cellRadius,
    padding: isMobile ? 14 : 20,
  }

  // Desktop is a sticky section nav beside a content column that takes the rest of a width capped
  // at 1480px (#464). The page used to be capped at 640px everywhere, which left a wide monitor
  // mostly empty. Phones keep the single column: there is no width to spend there.
  const sections = (
    <main style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
      {SECTIONS.map((s) => (
        <section
          key={s.id}
          id={sectionId(s.id)}
          aria-labelledby={`settings-${s.id}`}
          style={{ ...card, scrollMarginTop: 28 }}
        >
          <h2
            id={`settings-${s.id}`}
            tabIndex={-1}
            style={{
              margin: '0 0 14px',
              // Caveat, cork's hand-lettered face, sets far smaller than the other two themes' at the
              // same size, so cork's headings get more of it.
              fontSize: theme === 'cork' ? (isMobile ? 21 : 25) : isMobile ? 17 : 20,
              fontFamily: conf.title,
              outline: 'none',
            }}
          >
            {s.title}
          </h2>
          {s.render({ defaultView, onChangeView, boardSharing })}
        </section>
      ))}
    </main>
  )

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
          maxWidth: isMobile ? 640 : 1480,
          margin: '0 auto',
          display: 'flex',
          flexDirection: 'column',
          gap: isMobile ? 16 : 22,
        }}
      >
        <header style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 12 : 18 }}>
          <LinkButton to="/" size="sm">
            ← Board
          </LinkButton>
          <h1 style={{ fontFamily: conf.title, fontSize: isMobile ? 26 : 34, margin: 0 }}>
            Settings
          </h1>
          {isAdmin && (
            <LinkButton to="/admin" size="sm" style={{ marginLeft: 'auto' }}>
              Admin
            </LinkButton>
          )}
        </header>

        {isMobile ? (
          sections
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '240px minmax(0, 1fr)',
              gap: 28,
              alignItems: 'start',
            }}
          >
            <nav
              aria-label="Settings sections"
              style={{ ...card, padding: 8, position: 'sticky', top: 28 }}
            >
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 2 }}>
                {SECTIONS.map((s) => (
                  <li key={s.id}>
                    <a
                      href={`#${sectionId(s.id)}`}
                      aria-current={active === s.id ? 'true' : undefined}
                      onClick={(e) => {
                        // Scroll in place rather than follow the fragment: `public/`'s auth bootstrap
                        // reads `location.hash` on load, so the URL never carries one it did not put
                        // there. Focus moves to the heading so keyboard and screen-reader users land
                        // where sighted users do.
                        e.preventDefault()
                        jumpTo(s.id)
                        document.getElementById(sectionId(s.id))?.scrollIntoView?.({
                          behavior: 'smooth',
                          block: 'start',
                        })
                        document.getElementById(`settings-${s.id}`)?.focus({ preventScroll: true })
                      }}
                      style={navItemStyle(theme, conf, active === s.id)}
                    >
                      {s.title}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
            {sections}
          </div>
        )}

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

const SECTION_IDS = SECTIONS.map((s) => s.id)
const sectionId = (id: string) => `section-${id}`

/** How long the scroll must stay quiet before a nav jump's choice stops overriding the spy. */
const JUMP_SETTLE_MS = 150

/**
 * Which section the nav highlights, from `currentSection` on every scroll. Tracked only while the
 * nav is shown.
 *
 * `jumpTo` marks a nav click's target at once and holds it until the smooth scroll it starts has
 * been quiet for `JUMP_SETTLE_MS`. The held choice then stays until the next scroll. Without the
 * hold, the scroll would re-decide on the way and could land elsewhere: near the bottom of the
 * page, a section the page cannot scroll to the top reads as the last one (#464).
 */
function useActiveSection(ids: string[], enabled: boolean) {
  const [active, setActive] = useState(ids[0])
  const jumpTimer = useRef<number | null>(null)

  const holdJump = useCallback(() => {
    if (jumpTimer.current !== null) window.clearTimeout(jumpTimer.current)
    jumpTimer.current = window.setTimeout(() => {
      jumpTimer.current = null
    }, JUMP_SETTLE_MS)
  }, [])

  useEffect(() => {
    if (!enabled) return
    let frame = 0
    const measure = () => {
      frame = 0
      const root = document.documentElement
      const tops = ids.map(
        (id) => document.getElementById(sectionId(id))?.getBoundingClientRect().top ?? null,
      )
      const atBottom = window.scrollY + window.innerHeight >= root.scrollHeight - 2
      setActive(currentSection(ids, tops, { atBottom }))
    }
    const onScroll = () => {
      if (jumpTimer.current !== null) holdJump()
      else if (!frame) frame = requestAnimationFrame(measure)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      if (frame) cancelAnimationFrame(frame)
      if (jumpTimer.current !== null) window.clearTimeout(jumpTimer.current)
      jumpTimer.current = null
    }
  }, [ids, enabled, holdJump])

  const jumpTo = useCallback(
    (id: string) => {
      setActive(id)
      holdJump()
    },
    [holdJump],
  )

  return [active, jumpTo] as const
}

function AppearanceSection({ defaultView, onChangeView }: SectionContext) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <div style={{ fontSize: 13, opacity: 0.7, marginBottom: 6 }}>Theme</div>
        {/* A flex row, so the switcher's pill hugs its three buttons instead of stretching. */}
        <div style={{ display: 'flex' }}>
          <ThemeSwitcher />
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label htmlFor="settings-default-view" style={{ fontSize: 13, opacity: 0.7 }}>
          Default view
        </label>
        <Select
          id="settings-default-view"
          value={defaultView}
          onChange={(e) => onChangeView(e.target.value as ViewName)}
          style={{ maxWidth: 240 }}
        >
          <option value="calendar">Calendar</option>
          <option value="week">Week</option>
          <option value="agenda">Agenda</option>
          <option value="kanban">Board</option>
        </Select>
      </div>
    </div>
  )
}
