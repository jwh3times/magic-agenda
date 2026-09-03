import { createContext } from 'react'
import type { SnapshotFallbackReason } from './snapshotFallback'

export interface OfflineState {
  /** Writes are blocked: the board is hydrated from the snapshot, not from Supabase. */
  readOnly: boolean
  /** The most actionable reason one of the live Board reads failed. */
  fallbackReason: SnapshotFallbackReason | null
  /** When that snapshot was taken (epoch ms). Null when online. */
  savedAt: number | null
  /** Account timezone used to decide whether savedAt is today. Null means browser-local. */
  timezone: string | null
}

// Board UI reads this instead of a prop chain, because read-only touches components at
// several depths (toolbar, cards, editor) that otherwise share no props.
export const OfflineContext = createContext<OfflineState>({
  readOnly: false,
  fallbackReason: null,
  savedAt: null,
  timezone: null,
})
