import type { CSSProperties } from 'react'
import { useSettingsContext } from '../data/SettingsProvider'

const hint: CSSProperties = { margin: 0, fontSize: 13, opacity: 0.7, lineHeight: 1.45 }

/**
 * Settings → Keyboard shortcuts: the account's switch for the board's single-letter shortcuts
 * (#269). WCAG 2.1.4 requires character-key shortcuts to be possible to turn off, since they
 * collide with screen-reader and voice-control commands. It is an Account Preference, so it follows
 * the account to every device. Ctrl/Cmd+K is not a character-key shortcut and is not affected.
 */
export function KeyboardSection() {
  const { settings, saveKeyboardShortcuts } = useSettingsContext()
  if (!settings) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontWeight: 600 }}>
        <input
          type="checkbox"
          checked={settings.keyboardShortcuts}
          onChange={(e) => saveKeyboardShortcuts(e.target.checked)}
          style={{ width: 18, height: 18 }}
        />
        Single-letter shortcuts on the board
      </label>
      <p style={hint}>
        n new task · t today · 1–4 views · / search · ? all shortcuts. Turn these off if they clash
        with a screen reader or voice control. Ctrl+K (⌘K on a Mac) always opens the command
        palette.
      </p>
    </div>
  )
}
