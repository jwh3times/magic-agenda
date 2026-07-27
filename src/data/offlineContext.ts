import { createContext } from 'react'

export interface OfflineState {
  /** Writes are blocked: the board is hydrated from the snapshot, not from Supabase. */
  readOnly: boolean
  /** When that snapshot was taken (epoch ms). Null when online. */
  savedAt: number | null
}

// Board UI reads this instead of a prop chain, because read-only touches components at
// several depths (toolbar, cards, editor) that otherwise share no props.
export const OfflineContext = createContext<OfflineState>({ readOnly: false, savedAt: null })
