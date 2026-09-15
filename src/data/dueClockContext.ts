import { createContext, useContext, useState } from 'react'

export interface DueClockValue {
  readonly nowMs: number
  readonly timezone: string | null
}

export const DueClockContext = createContext<DueClockValue | null>(null)

/** Current instant plus the Account Timezone used to derive Due Moments. */
export function useDueClock(): DueClockValue {
  const current = useContext(DueClockContext)
  const [fallback] = useState<DueClockValue>(() => ({ nowMs: Date.now(), timezone: null }))
  return current ?? fallback
}
