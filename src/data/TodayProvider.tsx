import { useEffect, useState, type ReactNode } from 'react'
import { useSettingsContext } from './SettingsProvider'
import { todayYmd } from '../lib/dates'
import { TodayContext } from './todayContext'

const TICK_MS = 60_000

/**
 * Publishes today's date in the user's configured timezone.
 *
 * It re-evaluates on a timer and on `visibilitychange` rather than computing once at mount: a
 * board left open across midnight otherwise keeps highlighting yesterday, and a phone that was
 * asleep for a day would come back stale. `setState` only fires when the string actually
 * changes, so the overwhelmingly common case — same day, every tick — never re-renders anything.
 *
 * `today` is also corrected **during render** when `tz` changes, not only from an effect — React's
 * documented "adjusting state when a prop changes" pattern: calling `setState` mid-render, guarded
 * by comparing against a previous-value state variable, makes React discard this render and
 * re-run the component before it commits or renders children. That matters because
 * `SettingsProvider` finishing its load (tz becoming known) and a gated child mounting for the
 * first time (e.g. `Board`) can land in the very same commit: without the mid-render correction,
 * that child would read whatever stale `today` state this component's own `useState` initializer
 * produced back when `tz` was still null — its `useState(() => parseDay(today))` anchor
 * initializer only ever runs once, on the render where it first mounts, so it would never get
 * another chance to pick up the corrected date.
 *
 * Must be mounted inside `<SettingsProvider>`; `useSettingsContext` throws otherwise.
 */
export function TodayProvider({ children }: { children: ReactNode }) {
  const { settings } = useSettingsContext()
  const tz = settings?.timezone ?? null
  const [today, setToday] = useState(() => todayYmd(tz))
  const [lastTz, setLastTz] = useState(tz)

  if (lastTz !== tz) {
    setLastTz(tz)
    setToday(todayYmd(tz))
  }

  useEffect(() => {
    const sync = () =>
      setToday((prev) => {
        const next = todayYmd(tz)
        return next === prev ? prev : next
      })
    // No immediate call here: the render-phase adjustment above already corrects `today` the
    // instant `tz` changes, before this effect even runs. This interval + listener exist only for
    // midnight rollover — the calendar day changing underneath an unchanged `tz`.
    const id = window.setInterval(sync, TICK_MS)
    document.addEventListener('visibilitychange', sync)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', sync)
    }
  }, [tz])

  return <TodayContext.Provider value={today}>{children}</TodayContext.Provider>
}
