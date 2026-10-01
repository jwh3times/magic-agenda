import { useState, type CSSProperties } from 'react'
import { useThemeOrDefault } from '../theme/ThemeProvider'
import { barPercent, niceCeiling, shortUtcDay } from './chartScale'

export interface DailyPoint {
  /** A UTC day, `YYYY-MM-DD`. */
  day: string
  count: number
}

const PLOT_HEIGHT = 120
const BAR_MAX_WIDTH = 24

const muted: CSSProperties = { fontSize: 12, opacity: 0.7, fontVariantNumeric: 'tabular-nums' }

/**
 * One count per UTC day as a column chart (#468), for Admin's 30-day history.
 *
 * HTML columns rather than SVG: they share the card's width at any size without stretching the
 * rounded bar tops, and a phone gets narrower bars instead of a sideways scroll. One series per
 * chart, so its heading names it and no legend is needed; Admin draws New accounts and New Tasks
 * as two of these rather than one chart with two scales.
 *
 * The plot is `aria-hidden` behind a one-sentence summary, because thirty bars read aloud are
 * noise. The exact numbers are the table Admin renders beside it; pointing at a bar shows its day
 * and count in the readout above the plot.
 */
export function DailyChart({ title, points }: { title: string; points: readonly DailyPoint[] }) {
  const { conf } = useThemeOrDefault()
  const [hovered, setHovered] = useState<number | null>(null)

  const total = points.reduce((sum, p) => sum + p.count, 0)
  const peak = points.reduce<DailyPoint | null>(
    (best, p) => (best && best.count >= p.count ? best : p),
    null,
  )
  const axisMax = niceCeiling(peak?.count ?? 0)
  const point = hovered === null ? null : points[hovered]
  const summary =
    total === 0 || !peak
      ? `${title}: none in the last 30 days (UTC).`
      : `${title}: ${total} in the last 30 days (UTC), most on ${shortUtcDay(peak.day)} (${peak.count}).`

  // Hairlines one step off the card: the ink at low opacity, never a dashed line.
  const hairline: CSSProperties = {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    background: conf.numFg,
    opacity: 0.18,
  }

  return (
    <figure style={{ position: 'relative', margin: 0, minWidth: 0 }}>
      <figcaption style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 700, fontSize: 14 }}>{title}</span>
        <span aria-hidden="true" style={{ ...muted, fontSize: 13 }}>
          {point ? `${shortUtcDay(point.day)}: ${point.count}` : `${total} in 30 days`}
        </span>
      </figcaption>
      <p
        style={{
          position: 'absolute',
          width: 1,
          height: 1,
          overflow: 'hidden',
          clip: 'rect(0 0 0 0)',
          margin: -1,
        }}
      >
        {summary}
      </p>
      <div aria-hidden="true" style={{ display: 'flex', gap: 6, marginTop: 14 }}>
        {/* Each tick is centred on its own hairline: the axis maximum on the top one, 0 on the baseline. */}
        <div
          style={{
            ...muted,
            position: 'relative',
            height: PLOT_HEIGHT,
            lineHeight: 1,
            // Wide enough for the longest tick; the ticks themselves are absolutely positioned.
            width: `${String(axisMax).length}ch`,
          }}
        >
          <span style={{ position: 'absolute', right: 0, top: 0, transform: 'translateY(-50%)' }}>
            {axisMax}
          </span>
          <span style={{ position: 'absolute', right: 0, bottom: 0, transform: 'translateY(50%)' }}>
            0
          </span>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            data-testid="daily-plot"
            onPointerLeave={() => setHovered(null)}
            style={{ position: 'relative', height: PLOT_HEIGHT }}
          >
            <div style={{ ...hairline, top: 0 }} />
            <div style={{ ...hairline, bottom: 0, opacity: 0.35 }} />
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'flex-end',
                gap: 2,
              }}
            >
              {points.map((p, i) => (
                // Each column is the full plot height, so the hover target is bigger than the bar.
                <div
                  key={p.day}
                  data-testid="daily-column"
                  onPointerEnter={() => setHovered(i)}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    height: '100%',
                    display: 'flex',
                    alignItems: 'flex-end',
                    justifyContent: 'center',
                  }}
                >
                  <div
                    data-testid="daily-bar"
                    data-count={p.count}
                    style={{
                      width: '100%',
                      maxWidth: BAR_MAX_WIDTH,
                      height: `${barPercent(p.count, axisMax)}%`,
                      background: conf.chartMark,
                      borderRadius: '4px 4px 0 0',
                      opacity: hovered === null || hovered === i ? 1 : 0.45,
                    }}
                  />
                </div>
              ))}
            </div>
          </div>
          {points.length > 0 && (
            <div
              style={{ ...muted, display: 'flex', justifyContent: 'space-between', marginTop: 4 }}
            >
              <span>{shortUtcDay(points[0].day)}</span>
              <span>{shortUtcDay(points[points.length - 1].day)}</span>
            </div>
          )}
        </div>
      </div>
    </figure>
  )
}
