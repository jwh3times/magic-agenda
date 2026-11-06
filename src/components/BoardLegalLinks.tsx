import { Link } from 'react-router'
import { useTheme } from '../theme/ThemeProvider'
import { inboxChrome } from '../theme/chrome'

/**
 * ROADMAP 5.3 — the legal pages reachable from the board itself, not only from /settings and the
 * login screen. The roadmap suggested "the mobile toolbar overflow", but no overflow menu exists; the
 * Inbox's foot is a surface every view with an Inbox shows, and it costs neither board nor toolbar
 * space. Its colour is the panel's secondary text (`inboxLegal`, #625).
 */
export function BoardLegalLinks() {
  const { theme, conf } = useTheme()
  return (
    <div style={inboxChrome(theme, conf).inboxLegal}>
      <Link to="/privacy" style={{ color: 'inherit' }}>
        Privacy
      </Link>
      <Link to="/terms" style={{ color: 'inherit' }}>
        Terms
      </Link>
    </div>
  )
}
