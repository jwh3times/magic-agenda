import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Task } from '../types/task'
import { DueClockContext } from './dueClockContext'
import { nextLocalDayBoundaryMs, nextOverdueChangeAt } from './dueMoment'

// A bounded wake also corrects manual/system clock changes even when the tab never hides.
const MAX_WAKE_MS = 60 * 60 * 1000

/**
 * Publishes the clock used by Overdue derivation and wakes exactly when the next Task can cross a
 * Due Moment. Browser-throttled tabs catch up on visibilitychange.
 */
export function DueClockProvider({
  tasks,
  timezone,
  children,
}: {
  tasks: readonly Task[]
  timezone: string | null
  children: ReactNode
}) {
  const [nowMs, setNowMs] = useState(Date.now)

  useEffect(() => {
    let timer: number | undefined
    const schedule = (current: number) => {
      const overdueChange = nextOverdueChangeAt(tasks, current, timezone)
      const localDayChange = nextLocalDayBoundaryMs(current, timezone)
      const wakeAt =
        overdueChange === null ? localDayChange : Math.min(overdueChange, localDayChange)
      const delay = Math.max(0, Math.min(wakeAt - current, MAX_WAKE_MS))
      timer = window.setTimeout(sync, delay)
    }
    const sync = () => {
      if (timer !== undefined) window.clearTimeout(timer)
      const current = Date.now()
      setNowMs(current)
      schedule(current)
    }

    // Props can change long after the last scheduled wake. Refresh first so a newly loaded Task
    // that is already Overdue never waits for the next hour/day timer to become visible.
    sync()
    document.addEventListener('visibilitychange', sync)
    return () => {
      if (timer !== undefined) window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', sync)
    }
  }, [tasks, timezone])

  const value = useMemo(() => ({ nowMs, timezone }), [nowMs, timezone])
  return <DueClockContext.Provider value={value}>{children}</DueClockContext.Provider>
}
