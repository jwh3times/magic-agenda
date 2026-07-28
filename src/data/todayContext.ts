import { createContext, useContext } from 'react'
import { todayYmd } from '../lib/dates'

/**
 * Today's 'YYYY-MM-DD' in the user's configured timezone.
 *
 * The default is the browser's own today, so every consumer renders correctly unwrapped —
 * component tests need no new wrapper, and the signed-out landing page has no settings to read.
 *
 * Split out of `TodayProvider.tsx` so this stays a hook-only module: exporting a hook from a
 * file that also exports a component trips `react-refresh/only-export-components`.
 */
export const TodayContext = createContext<string>(todayYmd())

/** Today, in the user's timezone. Prefer this over `ymd(new Date())` in components. */
export function useToday(): string {
  return useContext(TodayContext)
}
