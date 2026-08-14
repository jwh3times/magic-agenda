import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import {
  cachedBoardIds,
  purgeBoardSnapshots,
  readDirectorySnapshot,
  writeDirectorySnapshot,
} from '../data/snapshot'
import { asBoardRole } from './role'
import { purgeableBoardIds, resolveSelection, type BoardSummary } from './selection'
import type { ViewName } from '../types/task'

/**
 * Loads the Boards this Account is a current member of, remembers which one was open, and purges
 * the local snapshots of Boards it can no longer reach.
 *
 * It takes `userId` and `hasSession` for the same reason `useTasks` and `useSettings` do: `userId`
 * may be a last-known id with no live session behind it (the offline-boot fallback), which is fine
 * for reading a snapshot and not fine for trusting an empty server response. See
 * `canPersistSnapshot`'s docstring for why that distinction is load-bearing rather than fussy.
 *
 * **The purge is the security-relevant part of this hook, not the Board list.** Access ending is
 * silent — the server simply stops returning a Board — so this is the only place that notices, and
 * it must notice before an empty task query gets interpreted as an empty Board.
 */

export interface UseBoardDirectory {
  boards: BoardSummary[]
  /** The Board the app should show, or null when this Account has none. */
  selectedBoardId: string | null
  selectBoard: (boardId: string) => void
  loading: boolean
  error: string | null
  /** True when the list came from a local snapshot rather than a live load. */
  offline: boolean
  reload: () => Promise<void>
  /** Set the Default View for one Board's Membership. The only Membership Preference so far. */
  setDefaultView: (boardId: string, view: ViewName) => Promise<void>
}

const REMEMBERED_KEY = 'ma-selected-board'

function readRemembered(): string | null {
  try {
    return localStorage.getItem(REMEMBERED_KEY)
  } catch {
    return null
  }
}

function writeRemembered(boardId: string | null): void {
  try {
    if (boardId) localStorage.setItem(REMEMBERED_KEY, boardId)
    else localStorage.removeItem(REMEMBERED_KEY)
  } catch {
    // best-effort, like every other storage access here
  }
}

/**
 * One membership row joined to its board, as the Data API returns it.
 *
 * The embedded `boards` relation comes back as an object for a to-one relationship, but PostgREST's
 * generated types describe it loosely enough that narrowing by hand is clearer than fighting them.
 */
interface MembershipRow {
  id: string
  board_id: string
  role: string
  default_view: string
  boards: { id: string; name: string } | { id: string; name: string }[] | null
}

function toSummary(row: MembershipRow): BoardSummary | null {
  const board = Array.isArray(row.boards) ? row.boards[0] : row.boards
  const role = asBoardRole(row.role)
  // A row whose role this client does not recognise means the client is older than the schema.
  // Dropping the board is the fail-closed answer: `asBoardRole` deliberately refuses to guess, and
  // showing a board while guessing at what may be done with it is the mistake worth avoiding.
  if (!board || !role) return null
  return {
    id: board.id,
    name: board.name,
    role,
    defaultView: row.default_view as ViewName,
    membershipId: row.id,
  }
}

export function useBoardDirectory(userId: string, hasSession: boolean): UseBoardDirectory {
  const [boards, setBoards] = useState<BoardSummary[]>([])
  const [remembered, setRemembered] = useState<string | null>(() => readRemembered())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [offline, setOffline] = useState(false)
  const inFlight = useRef(false)

  const hydrateFromSnapshot = useCallback((): boolean => {
    const snap = readDirectorySnapshot(userId)
    if (!snap) return false
    setBoards(snap.boards as BoardSummary[])
    setOffline(true)
    return true
  }, [userId])

  const reload = useCallback(async () => {
    if (!userId) {
      setLoading(false)
      return
    }
    if (inFlight.current) return
    inFlight.current = true
    setLoading(true)
    setError(null)
    try {
      const { data, error: err } = await supabase
        .from('board_memberships')
        .select('id, board_id, role, default_view, boards ( id, name )')
        .is('ended_at', null)
        .order('joined_at', { ascending: true })

      if (err) {
        if (hydrateFromSnapshot()) return
        setError(err.message)
        return
      }

      const next = ((data ?? []) as unknown as MembershipRow[])
        .map(toSummary)
        .filter((b): b is BoardSummary => b !== null)

      setBoards(next)
      setOffline(false)

      // Only a load made under a real session is authoritative about what this Account can reach.
      // A sessionless read succeeds against RLS with `[]` and no error, and treating that as "you
      // are in no boards" would purge every snapshot on the offline-boot path — destroying exactly
      // the data that path exists to show.
      if (hasSession) {
        purgeBoardSnapshots(purgeableBoardIds(cachedBoardIds(), next))
        const selected = resolveSelection(next, readRemembered())
        writeRemembered(selected)
        setRemembered(selected)
        writeDirectorySnapshot(userId, next, selected)
      }
    } catch (e) {
      if (hydrateFromSnapshot()) return
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
      inFlight.current = false
    }
  }, [userId, hasSession, hydrateFromSnapshot])

  useEffect(() => {
    // Same shape and same justification as the identical call in `useTasks`: `void reload()` runs
    // reload's synchronous prefix inline, and that prefix does call setState — `setLoading(true)`
    // and `setError(null)`, plus `setLoading(false)` on the signed-out early return. The rule is
    // right that setState happens during this effect.
    //
    // It is safe because it fires once rather than in a loop. On the initial mount both values are
    // identical to their `useState` initials, so React's Object.is bailout means neither triggers a
    // re-render; and `reload` is referentially stable in the inputs that matter — it depends on
    // `[userId, hasSession, hydrateFromSnapshot]`, and `hydrateFromSnapshot` on `[userId]` — so
    // calling it cannot change this effect's own dependencies and re-fire it.
    //
    // Note this disable blankets an entire async function, so any new synchronous setState added to
    // reload's pre-await prefix is silently un-linted. Re-verify this reasoning before adding one.
    // oxlint-disable-next-line react/react-compiler
    void reload()
  }, [reload])

  const selectBoard = useCallback((boardId: string) => {
    writeRemembered(boardId)
    setRemembered(boardId)
  }, [])

  /**
   * Set this Membership's Default View — the one Membership Preference the domain model defines.
   *
   * Written through the column-level `grant update (default_view)` rather than a command, which is
   * why this is a direct table write when every other Membership field is administration. RLS
   * scopes the row to the caller; the column grant is what stops the same statement from touching
   * `role`, because a policy cannot see the old row and so cannot express "only this column
   * changed".
   *
   * Optimistic, and deliberately not rolled back on failure: this is a display preference, and a
   * view that snaps back under the user mid-interaction is worse than one that is briefly out of
   * sync with a row nobody else is reading. The next load reconciles it.
   */
  const setDefaultView = useCallback(
    async (boardId: string, view: ViewName) => {
      setBoards((prev) => prev.map((b) => (b.id === boardId ? { ...b, defaultView: view } : b)))
      if (!hasSession) return
      const membershipId = boards.find((b) => b.id === boardId)?.membershipId
      if (!membershipId) return
      await supabase.from('board_memberships').update({ default_view: view }).eq('id', membershipId)
    },
    [boards, hasSession],
  )

  // Resolved rather than stored, so a remembered id that has gone away degrades to another board
  // instead of a blank screen — and so the answer cannot drift from the list it is derived from.
  const selectedBoardId = resolveSelection(boards, remembered)

  return { boards, selectedBoardId, selectBoard, setDefaultView, loading, error, offline, reload }
}
