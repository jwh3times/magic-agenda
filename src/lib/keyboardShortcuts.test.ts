import { describe, expect, it } from 'vitest'
import {
  isEditableTarget,
  shortcutFor,
  type ShortcutKey,
  type ShortcutState,
} from './keyboardShortcuts'

const key = (k: string, extra: Partial<ShortcutKey> = {}): ShortcutKey => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  repeat: false,
  targetEditable: false,
  ...extra,
})
const ON: ShortcutState = { characterShortcuts: true, blocked: false }
const OFF: ShortcutState = { characterShortcuts: false, blocked: false }

describe('shortcutFor: character shortcuts', () => {
  it('maps each single-character shortcut', () => {
    expect(shortcutFor(key('n'), ON)).toEqual({ type: 'new-task' })
    expect(shortcutFor(key('t'), ON)).toEqual({ type: 'today' })
    expect(shortcutFor(key('/'), ON)).toEqual({ type: 'search' })
    expect(shortcutFor(key('?'), ON)).toEqual({ type: 'help' })
    expect(shortcutFor(key('1'), ON)).toEqual({ type: 'view', view: 'calendar' })
    expect(shortcutFor(key('2'), ON)).toEqual({ type: 'view', view: 'week' })
    expect(shortcutFor(key('3'), ON)).toEqual({ type: 'view', view: 'agenda' })
    expect(shortcutFor(key('4'), ON)).toEqual({ type: 'view', view: 'kanban' })
  })

  it('ignores keys that are not shortcuts', () => {
    expect(shortcutFor(key('x'), ON)).toBeNull()
    expect(shortcutFor(key('5'), ON)).toBeNull()
    expect(shortcutFor(key('Enter'), ON)).toBeNull()
    // Shift+N arrives as "N": a capital is not the shortcut.
    expect(shortcutFor(key('N'), ON)).toBeNull()
  })

  it('is silent when the account has turned character shortcuts off (WCAG 2.1.4)', () => {
    for (const k of ['n', 't', '/', '?', '1', '4']) expect(shortcutFor(key(k), OFF)).toBeNull()
  })

  it('is silent while typing in an editable field', () => {
    expect(shortcutFor(key('n', { targetEditable: true }), ON)).toBeNull()
    expect(shortcutFor(key('/', { targetEditable: true }), ON)).toBeNull()
  })

  it('ignores a held-down key repeating', () => {
    expect(shortcutFor(key('n', { repeat: true }), ON)).toBeNull()
  })

  it('leaves chords to the browser', () => {
    expect(shortcutFor(key('n', { ctrlKey: true }), ON)).toBeNull()
    expect(shortcutFor(key('t', { metaKey: true }), ON)).toBeNull()
    expect(shortcutFor(key('1', { altKey: true }), ON)).toBeNull()
  })
})

describe('shortcutFor: the command palette', () => {
  it('opens on Ctrl+K and Cmd+K, whatever the case of the key', () => {
    expect(shortcutFor(key('k', { ctrlKey: true }), ON)).toEqual({ type: 'palette' })
    expect(shortcutFor(key('k', { metaKey: true }), ON)).toEqual({ type: 'palette' })
    expect(shortcutFor(key('K', { ctrlKey: true }), ON)).toEqual({ type: 'palette' })
  })

  it('works with character shortcuts off, because Ctrl/Cmd+K is not a character-key shortcut', () => {
    expect(shortcutFor(key('k', { ctrlKey: true }), OFF)).toEqual({ type: 'palette' })
  })

  it('works while typing in a field', () => {
    expect(shortcutFor(key('k', { ctrlKey: true, targetEditable: true }), ON)).toEqual({
      type: 'palette',
    })
  })

  it('does not treat Ctrl+Alt+K or a plain k as the palette', () => {
    expect(shortcutFor(key('k', { ctrlKey: true, altKey: true }), ON)).toBeNull()
    expect(shortcutFor(key('k'), ON)).toBeNull()
  })
})

describe('shortcutFor: an open dialog blocks everything', () => {
  it('fires nothing, not even the palette, while a dialog is open', () => {
    const blocked: ShortcutState = { characterShortcuts: true, blocked: true }
    expect(shortcutFor(key('n'), blocked)).toBeNull()
    expect(shortcutFor(key('k', { ctrlKey: true }), blocked)).toBeNull()
  })
})

describe('isEditableTarget', () => {
  it('recognizes form fields and content-editable elements', () => {
    expect(isEditableTarget(document.createElement('input'))).toBe(true)
    expect(isEditableTarget(document.createElement('textarea'))).toBe(true)
    expect(isEditableTarget(document.createElement('select'))).toBe(true)
    const editable = document.createElement('div')
    editable.contentEditable = 'true'
    // jsdom does not derive isContentEditable from the attribute, so set what a browser reports.
    Object.defineProperty(editable, 'isContentEditable', { value: true })
    expect(isEditableTarget(editable)).toBe(true)
  })

  it('rejects ordinary elements and non-elements', () => {
    expect(isEditableTarget(document.createElement('button'))).toBe(false)
    expect(isEditableTarget(document.body)).toBe(false)
    expect(isEditableTarget(null)).toBe(false)
    expect(isEditableTarget(window)).toBe(false)
  })
})
