import { useTheme } from '../theme/ThemeProvider'
import type { SaveConflict } from '../data/taskBoardContext'

/**
 * What an editor save that did not land says, and what the user can do about it (#433).
 *
 * Only `stale-revision` has a choice: someone else saved first, the board already shows their
 * version, and "Overwrite with mine" retries the save against the revision it now knows — a new,
 * deliberate command that can itself conflict again. A deleted Task and a lost Membership have
 * nothing to retry: saving over a deleted Task would resurrect it, which is exactly what the
 * compare-and-swap exists to prevent.
 */
export function ConflictDialog({
  conflict,
  busy,
  onKeepTheirs,
  onOverwrite,
}: {
  conflict: SaveConflict
  busy: boolean
  onKeepTheirs: () => void
  onOverwrite: () => void
}) {
  const { theme, conf } = useTheme()
  const dark = theme === 'glass'
  const stale = conflict.reason === 'stale-revision'

  return (
    <div
      role="alertdialog"
      aria-labelledby="conflict-message"
      style={{
        position: 'fixed',
        inset: 0,
        display: 'grid',
        placeItems: 'center',
        background: 'rgba(0,0,0,.35)',
        zIndex: 60,
        padding: 16,
      }}
    >
      <div
        style={{
          maxWidth: 420,
          width: '100%',
          padding: 18,
          borderRadius: 12,
          background: dark ? '#1b2133' : '#fffdf8',
          color: dark ? '#eaf0ff' : '#241c12',
          fontFamily: conf.ui,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          boxShadow: '0 10px 40px rgba(0,0,0,.3)',
        }}
      >
        <p id="conflict-message" style={{ margin: 0, fontSize: 14.5, lineHeight: 1.5 }}>
          {conflict.message}
        </p>
        {stale && (
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5, opacity: 0.75 }}>
            The board now shows their version. Keep it, or replace it with the changes you just
            made.
          </p>
        )}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {stale ? (
            <>
              <button type="button" onClick={onKeepTheirs} disabled={busy}>
                Keep theirs
              </button>
              <button type="button" onClick={onOverwrite} disabled={busy}>
                {busy ? 'Saving…' : 'Overwrite with mine'}
              </button>
            </>
          ) : (
            <button type="button" onClick={onKeepTheirs}>
              OK
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
