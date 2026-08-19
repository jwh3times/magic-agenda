import { useState } from 'react'
import { Link } from 'react-router'
import { useBoardDirectoryContext } from '../board/BoardDirectoryProvider'
import { useTheme } from '../theme/ThemeProvider'

/**
 * What an Account with no Boards sees.
 *
 * A real domain state rather than an error: `resolveSelection` returns null for it and documents
 * the product answer as offering to create one, never silently minting another. It is reachable
 * exactly one way today — deleting your last Board — and must be visibly distinct both from the
 * loading state and from a Board that simply has no tasks, because those three look identical if
 * this screen does not exist.
 *
 * Deliberately ordinary page content with its own `<main>` and `<h1>`, not a full-viewport overlay
 * like `ErrorScreen` and `Spinner`. Those are `position: fixed; inset: 0`, which axe's
 * `isModalOpen()` heuristic reads as an open modal — so `landmark-one-main` and
 * `page-has-heading-one` pass for free against them. A state a user can sit in should earn those
 * rather than be excused from them.
 */
export function NoBoards() {
  const { createBoard } = useBoardDirectoryContext()
  const { conf } = useTheme()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    setBusy(true)
    const failure = await createBoard(name)
    setBusy(false)
    setError(failure)
    if (!failure) setName('')
  }

  return (
    <div
      style={{
        minHeight: '100%',
        background: conf.pageBg,
        backgroundImage: conf.pageImg,
        backgroundSize: conf.pageSize,
        fontFamily: conf.ui,
        color: conf.numFg,
        padding: 28,
      }}
    >
      <main style={{ maxWidth: 520, margin: '0 auto', display: 'grid', gap: 14 }}>
        <h1 style={{ fontFamily: conf.title, fontSize: 30, margin: 0 }}>No boards yet</h1>
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55 }}>
          A board holds your tasks and its own labels. Create one to get started — it comes with a
          starter set of labels you can rename or delete later.
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <input
            aria-label="New board name"
            value={name}
            maxLength={120}
            placeholder="Board name"
            disabled={busy}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit()
            }}
            // ≥16px so iOS Safari does not zoom the page on focus.
            style={{ fontSize: 16, padding: '9px 11px', minWidth: 0, flex: '1 1 220px' }}
          />
          <button type="button" onClick={() => void submit()} disabled={busy}>
            {busy ? 'Creating…' : 'Create board'}
          </button>
        </div>
        {error && (
          <div role="alert" style={{ fontSize: 13 }}>
            {error}
          </div>
        )}
        <Link to="/settings" style={{ color: 'inherit', fontSize: 13 }}>
          Settings
        </Link>
      </main>
    </div>
  )
}
