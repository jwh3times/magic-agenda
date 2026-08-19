import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { checkBoardName, normalizeBoardName } from './boardName'
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
  /**
   * Create a Board, become its Owner, and open it. Resolves to an error message, or null on
   * success — nothing here rejects, for the same reason `AuthGateway` does not.
   */
  createBoard: (name: string) => Promise<string | null>
  /**
   * Delete a Board and everything in it. Resolves to an error message, or null on success.
   *
   * Destructive and irreversible — see `deleteBoard`'s own docstring for what "everything" covers.
   */
  deleteBoard: (boardId: string) => Promise<string | null>
  /** Rename a Board. Resolves to an error message, or null on success. */
  renameBoard: (boardId: string, name: string) => Promise<string | null>
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

  // Membership revalidation on catch-up.
  //
  // Realtime improves freshness; it is not the source of access truth. Nothing pushes "you were
  // removed" to this client: the server just stops returning the Board, and the task channel is
  // filtered by `board_id` so it goes quiet rather than announcing anything. Without this, a tab
  // that regains focus after a revocation would keep rendering a Board it no longer has, looking
  // live rather than stale.
  //
  // Deliberately mirrors `useSyncedTable`'s catch-up rather than living inside it: this hook has no
  // channel, and the question it answers — "do I still have access" — is not the one that module
  // asks. Note this covers waking and reconnecting, NOT a tab that simply stays open and focused; a
  // heartbeat for that case belongs with sharing, when a second person can actually revoke you.
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

  const selectBoard = useCallback((boardId: string) => {
    writeRemembered(boardId)
    setRemembered(boardId)
  }, [])

  /**
   * Create a Board through `public.create_board`, then reload and open it.
   *
   * An RPC rather than a pair of inserts, and not for convenience: a Board and its Owner Membership
   * must appear together — a Board with no Membership is unreachable by every policy — and there is
   * no non-escalating way to let a client write the Membership itself. `board_memberships` has no
   * INSERT policy at all, so this is the only path.
   *
   * Deliberately NOT optimistic, unlike every other write in this codebase. The server assigns the
   * id, and a `BoardSummary` also needs the Membership id that the same call creates, so there is
   * nothing truthful to render until the reload returns. Inventing a placeholder Board would mean
   * showing an entry that no query can find.
   */
  const createBoard = useCallback(
    async (name: string): Promise<string | null> => {
      if (!hasSession) return 'You need to be signed in to create a board.'

      const { data, error: rpcError } = await supabase.rpc('create_board', { board_name: name })
      if (rpcError || !data) {
        return rpcError?.message ?? 'Could not create the board.'
      }

      // Remember before reloading: `reload` resolves the selection itself and writes the result, so
      // setting it first is what makes the new Board the one that opens rather than a Board the
      // user was already on.
      writeRemembered(data)
      setRemembered(data)
      await reload()
      return null
    },
    [hasSession, reload],
  )

  /**
   * Rename a Board.
   *
   * Optimistic, unlike creation and deletion. Those change *which* Boards exist, so showing a
   * result the server has not agreed to means rendering an entry no query can find; a name is one
   * field of a row that is already there, and snapping it back on failure is honest rather than
   * confusing. The rollback restores the previous list rather than the previous name, so a
   * concurrent change to another Board is not clobbered by this one failing.
   */
  const renameBoard = useCallback(
    async (boardId: string, rawName: string): Promise<string | null> => {
      if (!hasSession) return 'You need to be signed in to rename a board.'

      const name = normalizeBoardName(rawName)
      const problem = checkBoardName(name)
      if (problem) return problem

      const previous = boards
      if (!previous.some((b) => b.id === boardId)) return null
      setBoards(previous.map((b) => (b.id === boardId ? { ...b, name } : b)))

      const { error: writeError } = await supabase.from('boards').update({ name }).eq('id', boardId)
      if (writeError) {
        setBoards(previous)
        return writeError.message
      }
      return null
    },
    [boards, hasSession],
  )

  /**
   * Delete a Board, then reload.
   *
   * A plain DELETE rather than an RPC: only one row is written here, and the Board's contents
   * follow through `on delete cascade` on `tasks`, `labels`, and `board_memberships`. That is also
   * why this is the most destructive call in the app — every Task in the Board (recurrence
   * templates and instances included) and its whole Label vocabulary go with it, and referential
   * actions are not subject to RLS, so nothing downstream gets a say. The Owner-only DELETE policy
   * is the entire boundary; `can.deleteBoard` only hides the control.
   *
   * Not optimistic. Removing the Board from local state before the server agrees would, on
   * failure, have to restore a Board the user just watched disappear — and if that Board was the
   * selected one, the app would swing through the zero-Board state and back. The reload afterwards
   * also does the snapshot cleanup for free: it purges any Board the server no longer returns.
   */
  const deleteBoard = useCallback(
    async (boardId: string): Promise<string | null> => {
      if (!hasSession) return 'You need to be signed in to delete a board.'

      const { error: deleteError } = await supabase.from('boards').delete().eq('id', boardId)
      if (deleteError) return deleteError.message

      // A refused DELETE is not an error — RLS makes it match zero rows and return success — so
      // reload and let the server's list be the answer rather than assuming this worked.
      await reload()
      return null
    },
    [hasSession, reload],
  )

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

  return {
    boards,
    selectedBoardId,
    selectBoard,
    createBoard,
    deleteBoard,
    renameBoard,
    setDefaultView,
    loading,
    error,
    offline,
    reload,
  }
}
