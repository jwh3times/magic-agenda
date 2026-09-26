import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import {
  REALTIME_SUBSCRIBE_STATES,
  type RealtimePostgresChangesPayload,
} from '@supabase/supabase-js'

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
 * Inside this window, a row whose events carry a `revision` (`tasks`) is suppressed only up to the
 * revision our own write produced, so a genuine edit from another device or member still arrives
 * (#432). A row without one (`user_settings`, `labels`) keeps the original caveat: id-keyed
 * suppression also drops another device's edit inside the window, and a reload or reconnect heals
 * it. So does a write whose caller never reports its outcome, which degrades to exactly that.
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

/**
 * A server-stamped row revision, or `null` when the value is not one.
 *
 * `tasks.revision` is a `bigint` stamped by `tasks_stamp_attribution` (#291). PostgREST and
 * Realtime both send it as a JSON number at any size this app will reach; a numeric string is
 * accepted too rather than silently treated as "no revision", which would fall back to dropping.
 */
function revisionOf(value: unknown): number | null {
  const n = typeof value === 'string' && value !== '' ? Number(value) : value
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

/** A row the server returned for one of our writes. Only `id` and `revision` are read. */
export interface WrittenRow {
  id: unknown
  revision?: unknown
}

export interface OwnWrites {
  /**
   * Mark ids as about to be written by this client. Until each write settles, their realtime
   * echoes are held back rather than delivered; after the TTL, nothing is suppressed.
   */
  markWrites: (ids: readonly (string | null | undefined)[]) => void
  /**
   * Report the rows a write returned. Echoes up to each row's revision are ours and stay
   * suppressed; anything newer is another writer's and is delivered, including one that arrived
   * while the write was in flight. `null` (a write that returned nothing) is ignored, leaving the
   * marked ids to the TTL.
   */
  settleWrites: (rows: readonly WrittenRow[] | null | undefined) => void
  /** Report that writes to these ids failed. A failed write produced no echo to wait for. */
  abandonWrites: (ids: readonly (string | null | undefined)[]) => void
  /**
   * Whether a realtime payload for row `id` must not be delivered now: `true` when it is this
   * client's own echo, or when it is being held until the write it might echo settles. A held
   * payload that proves to be someone else's is handed to `deliver` at that point.
   */
  screenEcho: (
    payload: ChangePayload,
    id: string,
    deliver: (payload: ChangePayload) => void,
  ) => boolean
}

interface OwnWriteEntry {
  expires: number
  /** Writes marked and not yet settled or abandoned. */
  pending: number
  /** Highest revision any settled write of ours produced, if one returned it. */
  revision: number | null
  /** The newest revisioned payload that arrived while a write was pending. */
  held: { payload: ChangePayload; revision: number; deliver: (p: ChangePayload) => void } | null
}

/**
 * The own-write registry, deliberately a hook of its own rather than part of `useSyncedTable`.
 *
 * Callers need `markWrites` at the top of their own hook (every mutation calls it) but can only
 * build `reload`/`onChange` further down, so folding this into `useSyncedTable` would force the
 * caller into a ref indirection just to break the cycle. This has no dependencies at all, so it
 * can be called first and its functions are stable forever.
 *
 * **Why an echo is held rather than decided on arrival.** Realtime can deliver a write's echo
 * before the HTTP response that says which revision the write produced, so on arrival there is no
 * way to tell our echo from another writer's edit. Holding the newest payload and deciding when
 * the write settles makes both cases right; a write that is never settled drops what it held at
 * the TTL, which is the original behaviour, not a new failure.
 *
 * DELETE payloads carry only the primary key, so they cannot be compared. One is treated as ours
 * while any write to that row is pending — which covers our own deletes, since nothing settles a
 * DELETE — and as another writer's once every write to it has settled.
 */
export function useOwnWrites(): OwnWrites {
  const entries = useRef(new Map<string, OwnWriteEntry>())

  const live = useCallback((id: string) => {
    const entry = entries.current.get(id)
    return entry && entry.expires > Date.now() ? entry : undefined
  }, [])

  const release = useCallback((entry: OwnWriteEntry) => {
    if (entry.pending > 0 || !entry.held) return
    const { held } = entry
    entry.held = null
    if (entry.revision === null || held.revision > entry.revision) held.deliver(held.payload)
  }, [])

  const markWrites = useCallback((ids: readonly (string | null | undefined)[]) => {
    const now = Date.now()
    // Sweep expired entries on every write so the Map cannot grow without bound across a long
    // session; there is no other prune.
    for (const [id, entry] of entries.current) if (entry.expires <= now) entries.current.delete(id)
    for (const id of ids) {
      if (!id) continue
      const entry = entries.current.get(id)
      if (entry) {
        entry.pending += 1
        entry.expires = now + OWN_WRITE_TTL_MS
      } else {
        entries.current.set(id, {
          expires: now + OWN_WRITE_TTL_MS,
          pending: 1,
          revision: null,
          held: null,
        })
      }
    }
  }, [])

  const settleWrites = useCallback(
    (rows: readonly WrittenRow[] | null | undefined) => {
      for (const row of rows ?? []) {
        if (typeof row.id !== 'string') continue
        const entry = live(row.id)
        if (!entry) continue
        entry.pending = Math.max(0, entry.pending - 1)
        const revision = revisionOf(row.revision)
        if (revision !== null) entry.revision = Math.max(entry.revision ?? revision, revision)
        release(entry)
      }
    },
    [live, release],
  )

  const abandonWrites = useCallback(
    (ids: readonly (string | null | undefined)[]) => {
      for (const id of ids) {
        const entry = id ? live(id) : undefined
        if (!entry) continue
        entry.pending = Math.max(0, entry.pending - 1)
        release(entry)
      }
    },
    [live, release],
  )

  const screenEcho = useCallback(
    (payload: ChangePayload, id: string, deliver: (payload: ChangePayload) => void) => {
      const entry = live(id)
      if (!entry) return false
      if (payload.eventType === 'DELETE') return entry.pending > 0
      const revision = revisionOf((payload.new as Record<string, unknown> | null)?.revision)
      // A table without revisions: the original id-keyed suppression for the whole TTL.
      if (revision === null) return true
      if (entry.pending > 0) {
        if (!entry.held || revision > entry.held.revision)
          entry.held = { payload, revision, deliver }
        return true
      }
      return entry.revision !== null && revision <= entry.revision
    },
    [live],
  )

  return { markWrites, settleWrites, abandonWrites, screenEcho }
}

export interface SyncedTableSpec {
  /** Empty means signed out: no channel is opened and no catch-up listener is registered. */
  userId: string
  table: 'tasks' | 'user_settings' | 'labels'
  /** Column holding the row id used for echo suppression. */
  primaryKey: string
  /**
   * The `postgres_changes` filter, and what scopes the channel.
   *
   * Used to be hardcoded to `user_id=eq.<userId>`, which stopped being right when task access
   * became board-scoped: a client subscribed by `user_id` would keep receiving changes for every
   * board the account belongs to, and would still be subscribed to rows it is no longer showing.
   * `tasks` and `labels` filter on `board_id`; `user_settings` still filters on `user_id`, because
   * that is genuinely what scopes it.
   *
   * An empty `filterValue` means "not resolvable yet" — the Board Directory has not settled — and
   * opens no channel, the same way an empty `userId` does.
   */
  filterColumn: string
  filterValue: string
  /**
   * Re-read everything from the server. Called on reconnect, tab focus, and network restore.
   * **Must be referentially stable** — it is an effect dependency, and an unstable identity would
   * tear down and rebuild the channel on every render.
   */
  reload: () => void | Promise<void>
  /** Handles a payload that is *not* one of this client's own writes. Must be stable. */
  onChange: (payload: ChangePayload) => void
  /** From `useOwnWrites`. Stable. */
  screenEcho: OwnWrites['screenEcho']
}

export function useSyncedTable({
  userId,
  table,
  primaryKey,
  filterColumn,
  filterValue,
  reload,
  onChange,
  screenEcho,
}: SyncedTableSpec): void {
  // Bumping the epoch forces a fresh channel after an error; reload() covers anything missed
  // while it was down.
  const [epoch, setEpoch] = useState(0)
  const retries = useRef(0)

  useEffect(() => {
    if (!userId || !filterValue) return
    let disposed = false
    // A payload the registry held back is delivered later, when the write it was waiting on
    // settles — possibly after this channel is gone. Deliver nothing to a torn-down channel: a
    // Board switch replaces it, and the late payload would land on the other Board's state.
    const deliverLate = (payload: ChangePayload) => {
      if (!disposed) onChange(payload)
    }
    const channel = supabase
      // Scoped by the filter value, not the user: two boards must not share one channel topic, or
      // switching between them would reuse a subscription bound to the wrong filter.
      .channel(`${table}-${filterValue}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table, filter: `${filterColumn}=eq.${filterValue}` },
        (payload) => {
          const id = rowIdOf(payload, primaryKey)
          if (id !== null && screenEcho(payload, id, deliverLate)) return
          onChange(payload)
        },
      )
      .subscribe((status) => {
        // `disposed` matters because the backoff timer outlives the channel it was scheduled by.
        if (disposed) return
        if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) {
          retries.current = 0
          return
        }
        if (
          status === REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR ||
          status === REALTIME_SUBSCRIBE_STATES.TIMED_OUT ||
          status === REALTIME_SUBSCRIBE_STATES.CLOSED
        ) {
          const delay = backoffDelay(retries.current++)
          void reload()
          window.setTimeout(() => {
            if (!disposed) setEpoch((e) => e + 1)
          }, delay)
        }
      })
    return () => {
      disposed = true
      void supabase.removeChannel(channel)
    }
    // `epoch` is an explicit reconnect trigger; the effect body does not otherwise read it.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [userId, table, primaryKey, filterColumn, filterValue, epoch, reload, onChange, screenEcho])

  // Mobile Safari (and others) kill background sockets aggressively — catch up on anything missed
  // when the tab regains focus or connectivity returns.
  useEffect(() => {
    if (!userId) return
    const onVisible = () => {
      if (document.visibilityState === 'visible') void reload()
    }
    const onOnline = () => void reload()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onOnline)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onOnline)
    }
  }, [userId, reload])
}
