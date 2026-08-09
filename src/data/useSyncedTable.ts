import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js'

/**
 * The realtime sync machinery both `useTasks` and `useSettings` need: a per-user channel, echo
 * suppression for this client's own writes, reconnect with backoff, and catch-up when the tab
 * wakes or the network returns.
 *
 * It was implemented twice, and the copies had diverged: two different echo-suppression schemes
 * with two different TTLs (a per-id Map at 5000ms vs a single timestamp at a bare 3000), and —
 * the reason this is a bug fix and not only a refactor — **`useSettings` had no reconnect path at
 * all**. Its entire subscription tail was `.subscribe()`: no status callback, no backoff, no
 * `visibilitychange`/`online` listener. A settings channel that errored after a phone slept was
 * dead for the rest of the session while the board kept syncing, so cross-device theme and
 * week-start changes silently stopped arriving. `AGENTS.md` described the two hooks as symmetric;
 * only one of them was. Closes #130.
 *
 * The module owns the machinery, not the data: each caller keeps its own load, state shape, and
 * snapshot envelope, and hands over four stable pieces (see `SyncedTableSpec`).
 */

/** A postgres_changes payload with the row shape left open — callers narrow it themselves. */
export type ChangePayload = RealtimePostgresChangesPayload<Record<string, unknown>>

/**
 * How long a write of ours stays "ours".
 *
 * Accepted caveat, unchanged from the original: id-keyed suppression also drops a *genuine* edit
 * to the same row from another device inside the window. A reload or reconnect heals it.
 */
export const OWN_WRITE_TTL_MS = 5000

const MAX_BACKOFF_MS = 30_000

/** Exponential backoff, capped. Exported so the cap and the curve are pinned by a test. */
export function backoffDelay(attempt: number): number {
  return Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempt)
}

/**
 * The row id a payload concerns, for echo suppression.
 *
 * DELETE carries `old`, everything else carries `new`. That asymmetry is not cosmetic: a DELETE
 * payload contains **only** the primary key (replica identity is DEFAULT, and Supabase forces
 * that for RLS-enabled tables regardless), so `new` is empty and reading it would make every
 * delete look like someone else's write.
 *
 * `primaryKey` differs per table — `tasks.id` versus `user_settings.user_id` — which is exactly
 * why this could not stay inline in one of the two hooks.
 */
export function rowIdOf(payload: ChangePayload, primaryKey: string): string | null {
  const record = (payload.eventType === 'DELETE' ? payload.old : payload.new) as Record<
    string,
    unknown
  > | null
  const value = record?.[primaryKey]
  return typeof value === 'string' ? value : null
}

export interface OwnWrites {
  /** Mark ids as written by this client, so their realtime echoes are ignored for the TTL. */
  markWrites: (ids: readonly (string | null | undefined)[]) => void
  isOwnWrite: (id: string) => boolean
}

/**
 * The own-write registry, deliberately a hook of its own rather than part of `useSyncedTable`.
 *
 * Callers need `markWrites` at the top of their own hook (every mutation calls it) but can only
 * build `reload`/`onChange` further down, so folding this into `useSyncedTable` would force the
 * caller into a ref indirection just to break the cycle. This has no dependencies at all, so it
 * can be called first and its two functions are stable forever.
 */
export function useOwnWrites(): OwnWrites {
  const ownWrites = useRef(new Map<string, number>())

  const markWrites = useCallback((ids: readonly (string | null | undefined)[]) => {
    const now = Date.now()
    // Sweep expired entries on every write so the Map cannot grow without bound across a long
    // session; there is no other prune.
    for (const [id, exp] of ownWrites.current) if (exp < now) ownWrites.current.delete(id)
    for (const id of ids) if (id) ownWrites.current.set(id, now + OWN_WRITE_TTL_MS)
  }, [])

  const isOwnWrite = useCallback((id: string) => {
    const exp = ownWrites.current.get(id)
    return exp !== undefined && exp > Date.now()
  }, [])

  return { markWrites, isOwnWrite }
}

export interface SyncedTableSpec {
  /** Empty means signed out: no channel is opened and no catch-up listener is registered. */
  userId: string
  table: 'tasks' | 'user_settings'
  /** Column holding the row id used for echo suppression. */
  primaryKey: string
  /**
   * Re-read everything from the server. Called on reconnect, tab focus, and network restore.
   * **Must be referentially stable** — it is an effect dependency, and an unstable identity would
   * tear down and rebuild the channel on every render.
   */
  reload: () => void
  /** Handles a payload that is *not* one of this client's own writes. Must be stable. */
  onChange: (payload: ChangePayload) => void
  /** From `useOwnWrites`. Stable. */
  isOwnWrite: (id: string) => boolean
}

export function useSyncedTable({
  userId,
  table,
  primaryKey,
  reload,
  onChange,
  isOwnWrite,
}: SyncedTableSpec): void {
  // Bumping the epoch forces a fresh channel after an error; reload() covers anything missed
  // while it was down.
  const [epoch, setEpoch] = useState(0)
  const retries = useRef(0)

  useEffect(() => {
    if (!userId) return
    let disposed = false
    const channel = supabase
      .channel(`${table}-${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table, filter: `user_id=eq.${userId}` },
        (payload) => {
          const id = rowIdOf(payload as ChangePayload, primaryKey)
          if (id !== null && isOwnWrite(id)) return
          onChange(payload as ChangePayload)
        },
      )
      .subscribe((status) => {
        // `disposed` matters because the backoff timer outlives the channel it was scheduled by.
        if (disposed) return
        if (status === 'SUBSCRIBED') {
          retries.current = 0
          return
        }
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          const delay = backoffDelay(retries.current++)
          reload()
          window.setTimeout(() => {
            if (!disposed) setEpoch((e) => e + 1)
          }, delay)
        }
      })
    return () => {
      disposed = true
      void supabase.removeChannel(channel)
    }
  }, [userId, table, primaryKey, epoch, reload, onChange, isOwnWrite])

  // Mobile Safari (and others) kill background sockets aggressively — catch up on anything missed
  // when the tab regains focus or connectivity returns.
  useEffect(() => {
    if (!userId) return
    const onVisible = () => {
      if (document.visibilityState === 'visible') reload()
    }
    const onOnline = () => reload()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onOnline)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onOnline)
    }
  }, [userId, reload])
}
