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
 * Must be mounted inside `<SettingsProvider>`; `useSettingsContext` throws otherwise.
 */
export function TodayProvider({ children }: { children: ReactNode }) {
  const { settings } = useSettingsContext()
  const tz = settings?.timezone ?? null
  const [today, setToday] = useState(() => todayYmd(tz))

  useEffect(() => {
    const sync = () =>
      setToday((prev) => {
        const next = todayYmd(tz)
        return next === prev ? prev : next
      })
    // Runs immediately too: the useState initializer only ever saw the first `tz`, so this is
    // what picks up a timezone the user just changed (or one that arrived over realtime).
    sync()
    const id = window.setInterval(sync, TICK_MS)
    document.addEventListener('visibilitychange', sync)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', sync)
    }
  }, [tz])

  return <TodayContext.Provider value={today}>{children}</TodayContext.Provider>
}
