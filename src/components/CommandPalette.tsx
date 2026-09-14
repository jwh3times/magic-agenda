import { useId, useState, type KeyboardEvent } from 'react'
import { useTheme } from '../theme/ThemeProvider'
import { useIsMobile } from '../lib/useMediaQuery'
import { editorChrome } from './editorChrome'

export interface PaletteCommand {
  id: string
  label: string
  run: () => void
}

/** What quick-add would create from the typed text, shown before it is committed. */
export interface QuickAddPreview {
  title: string
  /** Where the task would land, in words: "Friday, Sep 11" or "Inbox". */
  when: string
}

export interface CommandPaletteProps {
  commands: PaletteCommand[]
  /**
   * The typed text as a new task, or null when quick-add cannot run (read-only board, empty text).
   * The palette only previews and asks; the board decides what a quick-add creates.
   */
  quickAddPreview: (text: string) => QuickAddPreview | null
  onQuickAdd: (text: string) => void
  onClose: () => void
}

type Row =
  | { kind: 'quick-add'; id: string; label: string; hint: string }
  | { kind: 'command'; id: string; label: string; command: PaletteCommand }

/**
 * The Ctrl/Cmd+K command palette (#269): quick-add plus a few board commands.
 *
 * Focus stays in the text field the whole time — options are chosen with the arrow keys and Enter,
 * or clicked without taking focus — so it is an ARIA combobox over a listbox, and Escape always
 * reaches the field. With text typed, the first row is always "Add task …", previewing what
 * quick-add would create; Enter with nothing else highlighted creates it immediately, which is the
 * fast-capture path the palette exists for.
 */
export function CommandPalette({
  commands,
  quickAddPreview,
  onQuickAdd,
  onClose,
}: CommandPaletteProps) {
  const { theme, conf } = useTheme()
  const isMobile = useIsMobile()
  const c = editorChrome(theme, conf, isMobile)
  const listId = useId()
  const [text, setText] = useState('')
  const [active, setActive] = useState(0)

  const query = text.trim().toLowerCase()
  const preview = query ? quickAddPreview(text) : null
  const rows: Row[] = [
    ...(preview
      ? [
          {
            kind: 'quick-add' as const,
            id: 'quick-add',
            label: `Add task “${preview.title}”`,
            hint: preview.when,
          },
        ]
      : []),
    ...commands
      .filter((command) => !query || command.label.toLowerCase().includes(query))
      .map((command) => ({
        kind: 'command' as const,
        id: command.id,
        label: command.label,
        command,
      })),
  ]
  const current = rows.length ? Math.min(active, rows.length - 1) : -1
  const optionId = (index: number) => `${listId}-option-${index}`

  const choose = (row: Row) => {
    if (row.kind === 'quick-add') onQuickAdd(text)
    else row.command.run()
    onClose()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    } else if (e.key === 'ArrowDown' && rows.length) {
      e.preventDefault()
      setActive((current + 1) % rows.length)
    } else if (e.key === 'ArrowUp' && rows.length) {
      e.preventDefault()
      setActive((current - 1 + rows.length) % rows.length)
    } else if (e.key === 'Enter' && current >= 0) {
      e.preventDefault()
      choose(rows[current])
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(10,8,4,.55)',
        backdropFilter: 'blur(3px)',
        WebkitBackdropFilter: 'blur(3px)',
        display: 'grid',
        placeItems: isMobile ? 'start stretch' : 'start center',
        paddingTop: isMobile ? 12 : '12vh',
        zIndex: 9000,
      }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        style={{
          width: isMobile ? 'calc(100% - 24px)' : 'min(560px, 100%)',
          margin: isMobile ? '0 12px' : 0,
          background: c.panelBg,
          color: c.fg,
          border: `1px solid ${c.border}`,
          borderRadius: 16,
          boxShadow: '0 40px 100px rgba(0,0,0,.5)',
          fontFamily: c.ui,
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <input
          autoFocus
          role="combobox"
          aria-label="Type a command, or a task to add"
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={current >= 0 ? optionId(current) : undefined}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setActive(0)
          }}
          onKeyDown={onKeyDown}
          placeholder="Type a command, or “groceries tomorrow” to add a task…"
          style={{ ...c.inputBase, border: 'none', borderRadius: 0, padding: '16px 18px' }}
        />
        <ul
          id={listId}
          role="listbox"
          aria-label="Commands"
          style={{
            listStyle: 'none',
            margin: 0,
            padding: 6,
            maxHeight: '50vh',
            overflow: 'auto',
            borderTop: `1px solid ${c.border}`,
          }}
        >
          {rows.map((row, index) => (
            <li
              key={row.id}
              id={optionId(index)}
              role="option"
              aria-selected={index === current}
              // Keeps focus in the field, so Escape and the arrow keys still work after a click.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(row)}
              onMouseEnter={() => setActive(index)}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 12,
                padding: '10px 12px',
                borderRadius: 9,
                cursor: 'pointer',
                fontSize: 14,
                fontWeight: row.kind === 'quick-add' ? 700 : 500,
                background: index === current ? c.fieldBg : 'transparent',
                color: c.fg,
              }}
            >
              <span>{row.label}</span>
              {row.kind === 'quick-add' && <span style={{ color: c.sub }}>{row.hint}</span>}
            </li>
          ))}
          {rows.length === 0 && (
            <li role="presentation" style={{ padding: '10px 12px', color: c.sub, fontSize: 14 }}>
              No matching commands
            </li>
          )}
        </ul>
      </div>
    </div>
  )
}
