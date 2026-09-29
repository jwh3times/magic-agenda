import { useEffect, useState, type CSSProperties } from 'react'
import {
  calendarFeedUrl,
  readCalendarFeedToken,
  rotateCalendarFeedToken,
  subscribeUrl,
} from '../board/calendarFeed'
import type { BoardSummary } from '../board/selection'
import { useThemeOrDefault } from '../theme/ThemeProvider'
import { AnchorButton, Button, TextInput } from './controls'

const hint: CSSProperties = { fontSize: 12, opacity: 0.7 }
const row: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }

/**
 * One Board's calendar feed link, for the caller's own Membership (#277).
 *
 * Mounted only while open, and that is the point: the token is read when the panel opens, held in
 * this component's state, and gone when it unmounts. It never enters the Board directory, whose
 * snapshot is persisted for offline boot, because the token is a working read credential.
 *
 * The capability statement sits beside the link rather than behind a help icon, as #277 requires:
 * anyone holding the URL reads this Board without signing in, calendar apps keep it unprotected,
 * and rotation is the only way to revoke a copy that has been shared. Rotation asks first, because
 * it silently breaks every calendar already subscribed with the old link.
 */
export function CalendarFeedPanel({
  board,
  onClose,
}: {
  board: BoardSummary
  onClose: () => void
}) {
  const { conf } = useThemeOrDefault()
  const [token, setToken] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let current = true
    void readCalendarFeedToken(board.id).then((outcome) => {
      if (!current) return
      if (outcome.ok) setToken(outcome.value)
      else setError(outcome.failure.message)
    })
    return () => {
      current = false
    }
  }, [board.id])

  const rotate = async () => {
    setBusy(true)
    setError(null)
    const outcome = await rotateCalendarFeedToken(board.id)
    setBusy(false)
    setConfirming(false)
    if (!outcome.ok) {
      // The old token is still the live one, so it stays on screen.
      setError(outcome.failure.message)
      return
    }
    setToken(outcome.value)
    setCopied(false)
  }

  const url = token ? calendarFeedUrl(token) : null

  const copy = async () => {
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
    } catch {
      setError('Could not copy. Select the link and copy it yourself.')
    }
  }

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
      aria-label={`Calendar feed for ${board.name}`}
      role="group"
    >
      <p
        data-testid="calendar-feed-capability"
        style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5 }}
      >
        Subscribe to <strong>{board.name}</strong> from Google Calendar, Apple Calendar, or Outlook.
        Anyone with this link can see the board&apos;s scheduled tasks without signing in, and
        calendar apps store it unprotected, so share it like a password. Rotating the link is the
        only way to cut off a copy you have shared.
      </p>

      {error && (
        <div role="alert" style={{ color: conf.dangerFg, fontSize: 13 }}>
          {error}
        </div>
      )}

      {url === null && !error && <div style={hint}>Loading link…</div>}

      {url !== null && (
        <>
          <TextInput
            readOnly
            value={url}
            aria-label={`Calendar feed link for ${board.name}`}
            onFocus={(e) => e.currentTarget.select()}
            style={{ padding: '6px 8px', width: '100%' }}
          />
          <div style={row}>
            <Button size="sm" variant="primary" onClick={() => void copy()} disabled={busy}>
              {copied ? 'Copied' : 'Copy link'}
            </Button>
            <AnchorButton size="sm" href={subscribeUrl(url)}>
              Subscribe
            </AnchorButton>
            <div style={{ flex: 1 }} />
            {!confirming && (
              <Button
                size="sm"
                variant="danger"
                onClick={() => {
                  setError(null)
                  setConfirming(true)
                }}
                disabled={busy}
              >
                Rotate link…
              </Button>
            )}
            <Button size="sm" onClick={onClose} disabled={busy}>
              Hide
            </Button>
          </div>
          <div style={hint}>
            Calendar apps refresh on their own schedule; some take hours to show a change.
          </div>
        </>
      )}

      {url === null && error && (
        <div style={row}>
          <Button size="sm" onClick={onClose}>
            Hide
          </Button>
        </div>
      )}

      {confirming && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5 }}>
            The current link stops working everywhere it has been added, including your own
            calendars. Subscribe again with the new link afterwards.
          </p>
          <div style={row}>
            <Button size="sm" variant="destructive" onClick={() => void rotate()} disabled={busy}>
              {busy ? 'Rotating…' : 'Rotate'}
            </Button>
            <Button size="sm" onClick={() => setConfirming(false)} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
