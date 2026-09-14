import type { ViewName } from '../types/task'

/**
 * Which board command a key press means, decided without touching the DOM (#269).
 *
 * `useKeyboardShortcuts` is the thin adapter that reads a real `KeyboardEvent` into a `ShortcutKey`
 * and runs the result; every rule lives here so it can be tested exhaustively. Three rules matter
 * and are easy to get wrong:
 *
 * - **Ctrl/Cmd+K is not a character-key shortcut**, so it works even while typing in a field and
 *   even when the account has turned shortcuts off. WCAG 2.1.4 (Character Key Shortcuts) governs
 *   only shortcuts made of a single letter, digit, or punctuation mark, and those are the ones the
 *   `keyboardShortcuts` Account Preference switches off.
 * - **Nothing fires while a dialog is open.** The task editor, the palette, and the help overlay
 *   each own their keys; a board shortcut firing underneath one would act on a board the user
 *   cannot see.
 * - **Character shortcuts never fire while focus is in an editable field**, or typing "n" into the
 *   search box would open a new task.
 */

export type ShortcutAction =
  | { type: 'palette' }
  | { type: 'new-task' }
  | { type: 'today' }
  | { type: 'view'; view: ViewName }
  | { type: 'search' }
  | { type: 'help' }

/** The parts of a key press the decision reads. */
export interface ShortcutKey {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  repeat: boolean
  /** Focus is in an input, textarea, select, or content-editable element. */
  targetEditable: boolean
}

export interface ShortcutState {
  /** The account's `keyboardShortcuts` preference: whether single-character shortcuts are on. */
  characterShortcuts: boolean
  /** A dialog (task editor, palette, help) is open, so board shortcuts must stay quiet. */
  blocked: boolean
}

/** Board views in the order the number keys select them, matching the view switcher. */
export const VIEW_KEYS: Readonly<Record<string, ViewName>> = {
  '1': 'calendar',
  '2': 'week',
  '3': 'agenda',
  '4': 'kanban',
}

/** The single-character shortcuts, for the help overlay. One table so the two cannot drift. */
export const CHARACTER_SHORTCUTS: readonly { keys: string; label: string }[] = [
  { keys: 'n', label: 'New task' },
  { keys: 't', label: 'Go to today' },
  { keys: '1–4', label: 'Calendar, Week, Agenda, Board view' },
  { keys: '/', label: 'Search tasks' },
  { keys: '?', label: 'Show keyboard shortcuts' },
]

export function shortcutFor(e: ShortcutKey, state: ShortcutState): ShortcutAction | null {
  if (state.blocked) return null

  const modifier = e.ctrlKey || e.metaKey
  if (modifier && !e.altKey && e.key.toLowerCase() === 'k') return { type: 'palette' }
  // Any other chord belongs to the browser or the operating system, not to the board.
  if (modifier || e.altKey) return null

  if (!state.characterShortcuts || e.targetEditable || e.repeat) return null

  switch (e.key) {
    case 'n':
      return { type: 'new-task' }
    case 't':
      return { type: 'today' }
    case '/':
      return { type: 'search' }
    case '?':
      return { type: 'help' }
  }
  const view = VIEW_KEYS[e.key]
  return view ? { type: 'view', view } : null
}

/** Whether a key press landed in a place where typing, not a shortcut, is expected. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  // `=== true`, not a bare read: jsdom leaves isContentEditable undefined, and this promises a boolean.
  return target instanceof HTMLElement && target.isContentEditable === true
}
