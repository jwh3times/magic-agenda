import { useEffect } from 'react'
import { useTheme } from '../theme/ThemeProvider'
import { useIsMobile } from '../lib/useMediaQuery'
import { CHARACTER_SHORTCUTS } from '../lib/keyboardShortcuts'
import { editorChrome } from './editorChrome'

export interface ShortcutHelpProps {
  /** The account's preference: whether the single-character shortcuts listed here are on. */
  characterShortcuts: boolean
  onClose: () => void
  onOpenSettings?: () => void
}

/**
 * The `?` keyboard-shortcut overlay (#269). Its list comes from `CHARACTER_SHORTCUTS`, the same
 * table the shortcut rules are documented beside, so the overlay cannot describe a key that does
 * nothing. When the account has turned single-character shortcuts off it says so and points to
 * Settings, since the overlay can still be reached from the command palette.
 */
export function ShortcutHelp({ characterShortcuts, onClose, onOpenSettings }: ShortcutHelpProps) {
  const { theme, conf } = useTheme()
  const isMobile = useIsMobile()
  const c = editorChrome(theme, conf, isMobile)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const kbd = {
    display: 'inline-block',
    minWidth: 22,
    padding: '2px 7px',
    borderRadius: 6,
    border: `1px solid ${c.border}`,
    background: c.fieldBg,
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: 12.5,
    textAlign: 'center' as const,
  }
  const rows = [{ keys: 'Ctrl/⌘ K', label: 'Open the command palette' }, ...CHARACTER_SHORTCUTS]

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(10,8,4,.55)',
        backdropFilter: 'blur(3px)',
        WebkitBackdropFilter: 'blur(3px)',
        display: 'grid',
        placeItems: isMobile ? 'end stretch' : 'center',
        padding: isMobile ? 0 : 20,
        zIndex: 9000,
      }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcut-help-title"
        style={{
          width: isMobile ? '100%' : 'min(440px, 100%)',
          background: c.panelBg,
          color: c.fg,
          border: `1px solid ${c.border}`,
          borderRadius: isMobile ? '18px 18px 0 0' : 18,
          padding: 22,
          boxShadow: '0 40px 100px rgba(0,0,0,.5)',
          fontFamily: c.ui,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 id="shortcut-help-title" style={{ margin: 0, fontSize: 17 }}>
            Keyboard shortcuts
          </h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            style={{ ...c.btn(c.fieldBg, c.fg), padding: '6px 10px' }}
          >
            ✕
          </button>
        </div>
        {!characterShortcuts && (
          <p role="note" style={{ margin: '12px 0 0', fontSize: 13, color: c.sub }}>
            Single-letter shortcuts are turned off for your account, so only Ctrl/⌘ K works.{' '}
            {onOpenSettings && (
              <button
                type="button"
                onClick={onOpenSettings}
                style={{
                  background: 'none',
                  border: 'none',
                  padding: 0,
                  color: c.accent,
                  font: 'inherit',
                  cursor: 'pointer',
                  textDecoration: 'underline',
                }}
              >
                Turn them on in Settings
              </button>
            )}
          </p>
        )}
        <dl style={{ margin: '16px 0 0', display: 'grid', gap: 10 }}>
          {rows.map((row) => (
            <div
              key={row.keys}
              style={{ display: 'flex', justifyContent: 'space-between', gap: 16, fontSize: 14 }}
            >
              <dt style={{ opacity: characterShortcuts || row.keys === 'Ctrl/⌘ K' ? 1 : 0.5 }}>
                {row.label}
              </dt>
              <dd style={{ margin: 0 }}>
                <kbd style={kbd}>{row.keys}</kbd>
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  )
}
