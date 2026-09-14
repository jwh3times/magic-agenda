import { useEffect, useEffectEvent } from 'react'
import { isEditableTarget, shortcutFor, type ShortcutAction } from './keyboardShortcuts'

export interface KeyboardShortcutOptions {
  /** The account's `keyboardShortcuts` preference: whether single-character shortcuts fire. */
  characterShortcuts: boolean
  /** A dialog is open, so no board shortcut may fire underneath it. */
  blocked: boolean
  onAction: (action: ShortcutAction) => void
}

/**
 * Listens for board shortcuts on the document and runs the one a key press means (#269).
 *
 * Only the adapter: every rule about which key means what, and when a shortcut must stay quiet,
 * lives in `keyboardShortcuts.ts` where it is tested without a DOM. The listener is attached once;
 * `useEffectEvent` reads the latest preference, dialog state, and handler on each key press, so a
 * change in any of them never re-subscribes and never acts on a stale value.
 */
export function useKeyboardShortcuts({
  characterShortcuts,
  blocked,
  onAction,
}: KeyboardShortcutOptions): void {
  const handleKey = useEffectEvent((e: KeyboardEvent) => {
    // A key already handled elsewhere (a dialog's own Escape, a dnd-kit keyboard drag), or one in
    // the middle of IME composition, is not a shortcut.
    if (e.defaultPrevented || e.isComposing) return
    const action = shortcutFor(
      {
        key: e.key,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        altKey: e.altKey,
        repeat: e.repeat,
        targetEditable: isEditableTarget(e.target),
      },
      { characterShortcuts, blocked },
    )
    if (!action) return
    // Stops "/" typing into the field it is about to focus, and Ctrl+K reaching the browser.
    e.preventDefault()
    onAction(action)
  })

  useEffect(() => {
    const listener = (e: KeyboardEvent) => handleKey(e)
    document.addEventListener('keydown', listener)
    return () => document.removeEventListener('keydown', listener)
  }, [])
}
