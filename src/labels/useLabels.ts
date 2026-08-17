import { useCallback, useEffect, useRef, useState } from 'react'
import { readLabelSnapshot, writeLabelSnapshot } from '../data/snapshot'
import { supabase } from '../lib/supabase'
import type { Label } from '../types/label'

interface LabelRow {
  id: string
  board_id: string
  name: string
  dot_color: string
  position: number
}

const toLabel = (row: LabelRow): Label => ({
  id: row.id,
  boardId: row.board_id,
  name: row.name,
  dotColor: row.dot_color,
  position: row.position,
})

export interface UseLabels {
  labels: Label[]
  loading: boolean
  error: string | null
  /** True when labels came from the per-Board local snapshot. */
  offline: boolean
  savedAt: number | null
  reload: () => Promise<void>
}

/**
 * Read-only Board Label vocabulary with an offline snapshot and focus/online catch-up.
 *
 * Labels intentionally have no realtime channel in this slice. Definition management does not
 * ship until #179, so publishing another RLS table would widen the realtime surface without a UI
 * freshness benefit. Catch-up keeps a long-lived client current after navigation or reconnect.
 */
export function useLabels(userId: string, boardId: string, hasSession: boolean): UseLabels {
  const [labels, setLabels] = useState<Label[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [offline, setOffline] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const requestSequence = useRef(0)

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
        .select('id, board_id, name, dot_color, position')
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

  return { labels, loading, error, offline, savedAt, reload }
}
