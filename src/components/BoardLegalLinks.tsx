import { Link } from 'react-router'
import { useTheme } from '../theme/ThemeProvider'

/**
 * ROADMAP 5.3 — the legal pages reachable from the board itself, not only from /settings and the
 * login screen. The roadmap suggested "the mobile toolbar overflow", but no overflow menu exists; the
 * Inbox's foot is a surface every view with an Inbox shows, and it costs neither board nor toolbar
 * space.
 */
export function BoardLegalLinks() {
  const { conf } = useTheme()
  return (
    <div
      style={{
        margin: '0 16px 14px',
        display: 'flex',
        gap: 12,
        fontSize: 11,
        // 0.6, not 0.55: brutal's white inbox puts these at 4.17:1 at 0.55 — an AA near-miss
        // flagged by the E2E a11y ratchet. Imperceptible; do not round back down.
        opacity: 0.6,
        color: conf.numFg,
      }}
    >
      <Link to="/privacy" style={{ color: 'inherit' }}>
        Privacy
      </Link>
      <Link to="/terms" style={{ color: 'inherit' }}>
        Terms
      </Link>
    </div>
  )
}
