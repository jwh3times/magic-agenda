import { useEffect, useState } from 'react'
import { listBoardMembers } from './boardMembers'
import { NO_BOARD_MEMBERS, type BoardMembersValue } from './boardMembersContext'

/**
 * Loads the open Board's members for `BoardMembersContext` (#440), and only when sharing is on.
 *
 * With `enabled` false — the `board-sharing` flag off — nothing is fetched and the value stays
 * empty, so no Assignee control renders. A failed or refused read also yields the empty value:
 * Assignee is a convenience, and hiding it is the right degradation, never an error screen.
 * Refetched when the Board changes or the tab regains focus, which is when someone may have joined.
 */
export function useBoardMembersValue(
  boardId: string | null,
  enabled: boolean,
  me: string | null,
): BoardMembersValue {
  const [loaded, setLoaded] = useState<{ boardId: string; value: BoardMembersValue } | null>(null)

  useEffect(() => {
    if (!enabled || !boardId) return
    let current = true
    const load = () => {
      void listBoardMembers(boardId).then((outcome) => {
        if (!current) return
        setLoaded({
          boardId,
          value: outcome.ok ? { members: outcome.value, me } : NO_BOARD_MEMBERS,
        })
      })
    }
    load()
    const onVisible = () => {
      if (document.visibilityState === 'visible') load()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      current = false
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [boardId, enabled, me])

  // Never show one Board's members against another, even for the render before the refetch lands.
  if (!enabled || !boardId || loaded?.boardId !== boardId) return NO_BOARD_MEMBERS
  return loaded.value
}
