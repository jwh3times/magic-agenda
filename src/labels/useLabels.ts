import { useCallback, useEffect, useRef, useState } from 'react'
import { readLabelSnapshot, writeLabelSnapshot } from '../data/snapshot'
import { supabase } from '../lib/supabase'
import type { Label } from '../types/label'
import {
  changedPositions,
  checkColor,
  checkName,
  labelProblemFromError,
  moveLabel,
  nextPosition,
  normalizeName,
  type LabelProblem,
} from './labelIntent'

interface LabelRow {
  id: string
  board_id: string
  name: string
  dot_color: string
  position: number
}

const SELECT_COLUMNS = 'id, board_id, name, dot_color, position'

const toLabel = (row: LabelRow): Label => ({
  id: row.id,
  boardId: row.board_id,
  name: row.name,
  dotColor: row.dot_color,
  position: row.position,
})

const byPosition = (a: Label, b: Label) => a.position - b.position || a.id.localeCompare(b.id)

/**
 * No Board resolved, or no live session: refuse rather than write into the void.
 *
 * Module-level and pure so the mutation callbacks can call it without it becoming a dependency
 * that changes identity on every render.
 */
const writeGate = (boardId: string, hasSession: boolean): LabelProblem | null =>
  boardId && hasSession ? null : { reason: 'not-allowed' }

/**
 * A write either succeeded (`null`) or refused for one owned reason. Nothing here rejects, for the
 * same reason `AuthGateway` does not: a caller that forgets a `.catch` should get a rendered
 * message, not a component stuck mid-save.
 */
export type LabelWriteResult = LabelProblem | null

export interface UseLabels {
  labels: Label[]
  loading: boolean
  error: string | null
  /** True when labels came from the per-Board local snapshot. */
  offline: boolean
  savedAt: number | null
  reload: () => Promise<void>
  createLabel: (name: string, dotColor: string) => Promise<LabelWriteResult>
  renameLabel: (id: string, name: string) => Promise<LabelWriteResult>
  recolorLabel: (id: string, dotColor: string) => Promise<LabelWriteResult>
  reorderLabel: (id: string, delta: number) => Promise<LabelWriteResult>
  deleteLabel: (id: string) => Promise<LabelWriteResult>
}

/**
 * The selected Board's Label vocabulary: read with an offline snapshot and focus/online catch-up,
 * plus the Owner-only management writes added in #179.
 *
 * Labels still have no realtime channel. Catch-up already refreshes on navigation and reconnect,
 * definitions change rarely, and publishing another RLS table widens the DELETE fan-out surface —
 * so the freshness the issue asks for is bought here by catch-up rather than by publication.
 *
 * Every decision this hook makes lives in `labelIntent.ts`; what remains here is state, Supabase,
 * and rollback.
 */
export function useLabels(userId: string, boardId: string, hasSession: boolean): UseLabels {
  const [labels, setLabels] = useState<Label[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [offline, setOffline] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const requestSequence = useRef(0)

  const commit = useCallback(
    (next: Label[]) => {
      const ordered = [...next].sort(byPosition)
      setLabels(ordered)
      if (hasSession && userId && boardId) writeLabelSnapshot(userId, boardId, ordered)
    },
    [userId, boardId, hasSession],
  )

  const hydrateFromSnapshot = useCallback((): boolean => {
    const snapshot = readLabelSnapshot(userId, boardId)
    if (!snapshot) return false
    setLabels(snapshot.labels)
    setOffline(true)
    setSavedAt(snapshot.savedAt)
    setError(null)
    return true
  }, [userId, boardId])

  const reload = useCallback(async () => {
    const request = ++requestSequence.current
    if (!userId || !boardId) {
      setLabels([])
      setLoading(false)
      setError(null)
      setOffline(false)
      setSavedAt(null)
      return
    }

    setLoading(true)
    setError(null)
    try {
      const { data, error: loadError } = await supabase
        .from('labels')
        .select(SELECT_COLUMNS)
        .eq('board_id', boardId)
        .order('position', { ascending: true })
        .order('id', { ascending: true })

      if (request !== requestSequence.current) return
      if (loadError) {
        if (!hydrateFromSnapshot()) setError(loadError.message)
        return
      }

      const next = ((data ?? []) as LabelRow[]).map(toLabel)
      const now = Date.now()
      setLabels(next)
      setOffline(false)
      setSavedAt(now)
      if (hasSession) writeLabelSnapshot(userId, boardId, next)
    } catch (caught) {
      if (request !== requestSequence.current) return
      if (!hydrateFromSnapshot()) {
        setError(caught instanceof Error ? caught.message : String(caught))
      }
    } finally {
      if (request === requestSequence.current) setLoading(false)
    }
  }, [userId, boardId, hasSession, hydrateFromSnapshot])

  useEffect(() => {
    // The synchronous state updates are bounded to this stable dependency set and cannot loop.
    // oxlint-disable-next-line react/react-compiler
    void reload()
  }, [reload])

  useEffect(() => {
    if (!userId || !boardId) return
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
  }, [userId, boardId, reload])

  const createLabel = useCallback(
    async (rawName: string, dotColor: string): Promise<LabelWriteResult> => {
      const blocked = writeGate(boardId, hasSession)
      if (blocked) return blocked

      const name = normalizeName(rawName)
      const problem = checkName(name, labels) ?? checkColor(dotColor)
      if (problem) return problem

      // The id is deliberately absent: `grant insert (board_id, name, dot_color, position)` does
      // not include it, so the server assigns it and we read the row back rather than inventing a
      // temporary id to reconcile later.
      const { data, error: writeError } = await supabase
        .from('labels')
        .insert({
          board_id: boardId,
          name,
          dot_color: dotColor,
          position: nextPosition(labels),
        })
        .select(SELECT_COLUMNS)
        .single()

      if (writeError || !data) return labelProblemFromError(writeError)
      commit([...labels, toLabel(data)])
      return null
    },
    [boardId, hasSession, commit, labels],
  )

  const renameLabel = useCallback(
    async (id: string, rawName: string): Promise<LabelWriteResult> => {
      const blocked = writeGate(boardId, hasSession)
      if (blocked) return blocked

      const name = normalizeName(rawName)
      const problem = checkName(name, labels, id)
      if (problem) return problem

      const previous = labels
      if (!previous.some((l) => l.id === id)) return null
      commit(previous.map((l) => (l.id === id ? { ...l, name } : l)))

      const { error: writeError } = await supabase.from('labels').update({ name }).eq('id', id)
      if (writeError) {
        commit(previous)
        return labelProblemFromError(writeError)
      }
      return null
    },
    [boardId, hasSession, commit, labels],
  )

  const recolorLabel = useCallback(
    async (id: string, dotColor: string): Promise<LabelWriteResult> => {
      const blocked = writeGate(boardId, hasSession)
      if (blocked) return blocked

      const problem = checkColor(dotColor)
      if (problem) return problem

      const previous = labels
      if (!previous.some((l) => l.id === id)) return null
      commit(previous.map((l) => (l.id === id ? { ...l, dotColor } : l)))

      const { error: writeError } = await supabase
        .from('labels')
        .update({ dot_color: dotColor })
        .eq('id', id)
      if (writeError) {
        commit(previous)
        return labelProblemFromError(writeError)
      }
      return null
    },
    [boardId, hasSession, commit, labels],
  )

  const reorderLabel = useCallback(
    async (id: string, delta: number): Promise<LabelWriteResult> => {
      const blocked = writeGate(boardId, hasSession)
      if (blocked) return blocked

      const previous = labels
      const next = moveLabel(previous, id, delta)
      if (!next) return null

      commit(next)

      // One UPDATE per moved row: `id` is not in the INSERT grant, so PostgREST upsert — which is
      // INSERT ... ON CONFLICT and needs it — is unavailable here. `changedPositions` is what keeps
      // that from being one request per Label. Nothing constrains (board_id, position) to be
      // unique, so a partially applied reorder is a cosmetic ordering, not a broken row, and the
      // next move renumbers densely over it.
      for (const label of changedPositions(previous, next)) {
        const { error: writeError } = await supabase
          .from('labels')
          .update({ position: label.position })
          .eq('id', label.id)
        if (writeError) {
          commit(previous)
          return labelProblemFromError(writeError)
        }
      }
      return null
    },
    [boardId, hasSession, commit, labels],
  )

  const deleteLabel = useCallback(
    async (id: string): Promise<LabelWriteResult> => {
      const blocked = writeGate(boardId, hasSession)
      if (blocked) return blocked

      const previous = labels
      if (!previous.some((l) => l.id === id)) return null

      // Assigned Tasks become Unlabeled by `on delete set null (label_id)`, not by anything here.
      // A Task loaded in another tab is corrected by that tab's own realtime channel.
      commit(previous.filter((l) => l.id !== id).map((l, index) => ({ ...l, position: index })))

      const { error: writeError } = await supabase.from('labels').delete().eq('id', id)
      if (writeError) {
        commit(previous)
        return labelProblemFromError(writeError)
      }
      return null
    },
    [boardId, hasSession, commit, labels],
  )

  return {
    labels,
    loading,
    error,
    offline,
    savedAt,
    reload,
    createLabel,
    renameLabel,
    recolorLabel,
    reorderLabel,
    deleteLabel,
  }
}
