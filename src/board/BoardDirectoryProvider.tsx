import { createContext, useContext, type ReactNode } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { readLastUserId } from '../lib/lastUser'
import { useBoardDirectory, type UseBoardDirectory } from './useBoardDirectory'
import { capabilitiesFor, type BoardCapabilities } from './role'
import { selectedBoard, type BoardSummary } from './selection'

const BoardDirectoryContext = createContext<UseBoardDirectory | null>(null)

/**
 * Owns which Boards this Account has, and which one is open, for the whole signed-in session.
 *
 * Mounted **above `<Routes>`** for the same reason as `SettingsProvider`: `/` and `/settings` are
 * mutually exclusive routes, so a per-page hook would refetch the Board list and re-resolve the
 * selection on every navigation between them. It is also a hard requirement rather than an
 * optimisation — `DataSection` lives on `/settings` and writes tasks on import, so it needs a Board
 * id just as much as the board does. Without this it would have to fall back to the database's
 * temporary `board_id` inference trigger, and that trigger is dropped once a second Board can
 * exist; an importer depending on it would break exactly then, silently and far from this code.
 *
 * Unlike `useTasks`, hoisting this costs nothing at the entry chunk: it is one small query and a
 * pure selection, with no dnd-kit or board data layer behind it.
 */
export function BoardDirectoryProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  // Same split as everywhere else: `userId` may come from the stale `ma-last-user` so an offline
  // boot can find its snapshot, while `hasSession` is the stricter signal that gates anything
  // authoritative — here, purging snapshots and rewriting the remembered selection.
  const value = useBoardDirectory(user?.id ?? readLastUserId(), Boolean(user))
  return <BoardDirectoryContext.Provider value={value}>{children}</BoardDirectoryContext.Provider>
}

/** The session's Board list and selection. Throws outside the provider rather than returning null. */
// oxlint-disable-next-line react/only-export-components
export function useBoardDirectoryContext(): UseBoardDirectory {
  const ctx = useContext(BoardDirectoryContext)
  if (!ctx) throw new Error('useBoardDirectoryContext must be used within <BoardDirectoryProvider>')
  return ctx
}

export interface BoardSession {
  /** The Board currently open, or null when this Account has none. */
  board: BoardSummary | null
  /** What the caller may do in it. `NO_CAPABILITIES` when there is no Board. */
  can: Readonly<BoardCapabilities>
}

/**
 * The selected Board and what may be done with it.
 *
 * Deliberately a derived view over the directory rather than a second context. Components ask
 * `can.editContent`, never `board.role === 'editor'` — the role string stops at this seam, which is
 * what keeps a permission model from drifting out of sync with the one table that defines it.
 */
// oxlint-disable-next-line react/only-export-components
export function useBoardSession(): BoardSession {
  const { boards, selectedBoardId } = useBoardDirectoryContext()
  const board = selectedBoard(boards, selectedBoardId)
  return { board, can: capabilitiesFor(board?.role) }
}
