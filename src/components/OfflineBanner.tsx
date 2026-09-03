import { dateYmd, todayYmd } from '../lib/dates'
import { useTheme } from '../theme/ThemeProvider'
import type { SnapshotFallbackReason } from '../data/snapshotFallback'

function formatterOptions(timezone: string | null): Intl.DateTimeFormatOptions {
  return timezone ? { timeZone: timezone } : {}
}

function savedWhen(savedAt: number | null, timezone: string | null): string | null {
  if (savedAt === null || !Number.isFinite(savedAt)) return null
  const saved = new Date(savedAt)
  const zone = formatterOptions(timezone)
  try {
    const time = saved.toLocaleTimeString([], { ...zone, hour: 'numeric', minute: '2-digit' })
    if (dateYmd(saved, timezone) === todayYmd(timezone)) return `as of ${time}`
    const date = saved.toLocaleDateString([], {
      ...zone,
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
    return `saved on ${date} at ${time}`
  } catch {
    // A stale/hand-edited timezone must not take down the fallback that keeps the board readable.
    return timezone ? savedWhen(savedAt, null) : null
  }
}

const heading: Record<SnapshotFallbackReason, string> = {
  network: 'Offline.',
  auth: 'Access couldn’t be verified.',
  'request-error': 'Couldn’t refresh.',
}

export function OfflineBanner({
  reason,
  savedAt,
  timezone,
}: {
  reason: SnapshotFallbackReason
  savedAt: number | null
  timezone: string | null
}) {
  const { conf } = useTheme()
  const when = savedWhen(savedAt, timezone)
  const recovery =
    reason === 'network'
      ? 'Changes are disabled until you reconnect.'
      : 'Changes are disabled until the board refreshes successfully.'
  return (
    <div
      role="status"
      style={{
        margin: '0 12px 8px',
        padding: '8px 12px',
        borderRadius: conf.cellRadius,
        background: conf.cellToday,
        color: conf.numFg,
        border: conf.cellBorder,
        fontFamily: conf.ui,
        fontSize: 13.5,
        lineHeight: 1.4,
      }}
    >
      <strong style={{ fontWeight: 700 }}>{heading[reason]}</strong>{' '}
      {when ? `Showing your board ${when}.` : 'Showing your last saved board.'} {recovery}
    </div>
  )
}
