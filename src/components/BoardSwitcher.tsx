import { useState } from 'react'
import { useOptionalBoardDirectory } from '../board/boardDirectoryContext'
import { toolbarChrome } from '../theme/chrome'
import { useTheme } from '../theme/ThemeProvider'

/**
 * The sentinel option that opens the creator.
 *
 * A uuid can never collide with it, and putting creation inside the same control is what keeps
 * "switch board" and "make a board" one decision for the user instead of two hunts.
 */
const NEW_BOARD = '__new__'

const MAX_NAME = 120

/**
 * Board switching and creation, in one toolbar slot.
 *
 * Renders `null` outside a `BoardDirectoryProvider` rather than throwing: the Toolbar is exercised
 * on its own and by the landing preview, and a switcher is chrome those surfaces legitimately do
 * not have. Anything that genuinely needs the Board list should use `useBoardDirectoryContext`.
 *
 * The creator replaces the select in place rather than expanding below it. The toolbar is a fixed
 * set of rows whose mobile layout depends on `flexWrap: 'nowrap'`, so a slot that grows a second
 * row is how that layout breaks; swapping the contents of one slot cannot.
 */
export function BoardSwitcher() {
  const directory = useOptionalBoardDirectory()
  const { theme, conf } = useTheme()
  const [focused, setFocused] = useState(false)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!directory) return null
  const { boards, selectedBoardId, selectBoard, createBoard } = directory
  if (boards.length === 0) return null

  // Toolbar-drawn rather than browser-default (#483); the styles keep 16px text, so iOS Safari
  // does not zoom the page when either control takes focus.
  const c = toolbarChrome(theme, conf)

  const cancel = () => {
    setCreating(false)
    setName('')
    setError(null)
  }

  const submit = async () => {
    setBusy(true)
    const failure = await createBoard(name)
    setBusy(false)
    if (failure) {
      setError(failure)
      return
    }
    // `createBoard` already selected the new Board, so there is nothing to switch to here.
    setCreating(false)
    setName('')
    setError(null)
  }

  if (creating) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        <input
          aria-label="New board name"
          value={name}
          maxLength={MAX_NAME}
          placeholder="Board name"
          autoFocus
          disabled={busy}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit()
            if (e.key === 'Escape') cancel()
          }}
          style={{
            ...c.field,
            minWidth: 72,
            maxWidth: 190,
            // index.css removes the outline from focused inputs, so the field draws its own ring.
            boxShadow: focused ? `0 0 0 2px ${conf.toolbarFg}` : 'none',
          }}
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy}
          style={{ ...c.addBtn, flex: 'none' }}
        >
          Create
        </button>
        <button
          type="button"
          onClick={cancel}
          disabled={busy}
          style={{ ...c.todayBtn, flex: 'none' }}
        >
          Cancel
        </button>
        {error && (
          <span role="alert" style={{ fontSize: 12 }}>
            {error}
          </span>
        )}
      </div>
    )
  }

  return (
    <select
      aria-label="Board"
      value={selectedBoardId ?? ''}
      onChange={(e) => {
        if (e.target.value === NEW_BOARD) {
          setError(null)
          setCreating(true)
          return
        }
        selectBoard(e.target.value)
      }}
      style={{ ...c.select, minWidth: 72, maxWidth: 190 }}
    >
      {boards.map((board) => (
        <option key={board.id} value={board.id} style={c.option}>
          {board.name}
        </option>
      ))}
      <option value={NEW_BOARD} style={c.option}>
        + New board…
      </option>
    </select>
  )
}
