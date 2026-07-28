import { useMemo, type CSSProperties } from 'react'
import { useSettingsContext } from '../data/SettingsProvider'
import { browserTimezone, supportedTimezones, WEEKDAYS_LONG } from '../lib/dates'

// The three week starts that exist in practice: Sunday (US/Canada/Japan), Monday (ISO 8601),
// Saturday (much of the Middle East). The column accepts 0–6; this is only what we offer.
const WEEK_START_OPTIONS = [0, 1, 6]

/**
 * Region `<optgroup>`s from the IANA prefix. Single-segment ids (UTC, GMT, the legacy aliases)
 * would each become a one-entry group, so they collect into a trailing "Other" instead.
 *
 * Module-private on purpose: exporting a non-component from a `.tsx` file trips
 * `react-refresh/only-export-components`.
 */
function groupZones(zones: string[]): { region: string; zones: string[] }[] {
  const byRegion = new Map<string, string[]>()
  for (const z of zones) {
    const slash = z.indexOf('/')
    const region = slash === -1 ? 'Other' : z.slice(0, slash)
    const arr = byRegion.get(region) ?? []
    arr.push(z)
    byRegion.set(region, arr)
  }
  const regions = [...byRegion.keys()].filter((r) => r !== 'Other').sort()
  if (byRegion.has('Other')) regions.push('Other')
  return regions.map((region) => ({ region, zones: [...(byRegion.get(region) ?? [])].sort() }))
}

// ≥16px so iOS Safari doesn't zoom the page on focus.
const select: CSSProperties = { fontSize: 16, padding: '8px 10px', maxWidth: 280 }
const label: CSSProperties = { fontSize: 13, opacity: 0.7 }
const field: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6 }

/** Week start + timezone. Reads the settings context directly, like DataSection and DangerZone. */
export function DatesSection() {
  const { settings, saveWeekStart, saveTimezone } = useSettingsContext()
  const groups = useMemo(() => groupZones(supportedTimezones()), [])
  const auto = browserTimezone()

  if (!settings) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={field}>
        <label htmlFor="settings-week-start" style={label}>
          Week starts on
        </label>
        <select
          id="settings-week-start"
          value={String(settings.weekStart)}
          onChange={(e) => saveWeekStart(Number(e.target.value))}
          style={select}
        >
          {WEEK_START_OPTIONS.map((d) => (
            <option key={d} value={d}>
              {WEEKDAYS_LONG[d]}
            </option>
          ))}
        </select>
      </div>

      <div style={field}>
        <label htmlFor="settings-timezone" style={label}>
          Timezone
        </label>
        <select
          id="settings-timezone"
          value={settings.timezone ?? ''}
          onChange={(e) => saveTimezone(e.target.value === '' ? null : e.target.value)}
          style={select}
        >
          <option value="">Automatic ({auto})</option>
          {groups.map((g) => (
            <optgroup key={g.region} label={g.region}>
              {g.zones.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <div style={{ fontSize: 12, opacity: 0.6 }}>
          Sets which day counts as “today” for the board and for overdue tasks.
        </div>
      </div>
    </div>
  )
}
