import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { supabase } from '../lib/supabase'
import { rowToTask, taskToRow } from './mappers'
import { applyToggleDone } from './selectors'
import type { Task } from '../types/task'
import type { Mode } from '../dnd/reorder'

export interface UseTasks {
  tasks: Task[]
  loading: boolean
  error: string | null
  reload: () => void
  /** Optimistic local setter (used by drag-over); keeps the internal ref in sync. */
  setTasks: Dispatch<SetStateAction<Task[]>>
  createTask: (task: Task) => Promise<void>
  updateTask: (task: Task) => Promise<void>
  removeTask: (id: string) => Promise<void>
  toggleDone: (id: string) => Promise<void>
  persistReorder: (next: Task[], containers: string[], mode: Mode) => Promise<void>
}

/** Single source of truth for tasks: load via RLS-scoped select, optimistic CRUD with rollback. */
export function useTasks(userId: string): UseTasks {
  const [tasks, _setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const tasksRef = useRef<Task[]>([])

  // Wrapped setter keeps tasksRef synchronous so mutations can read the latest list.
  const setTasks = useCallback<Dispatch<SetStateAction<Task[]>>>((update) => {
    _setTasks((prev) => {
      const next = typeof update === 'function' ? (update as (p: Task[]) => Task[])(prev) : update
      tasksRef.current = next
      return next
    })
  }, [])

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error: err } = await supabase.from('tasks').select('*')
    if (err) {
      setError(err.message)
      setLoading(false)
      return
    }
    setTasks((data ?? []).map(rowToTask))
    setLoading(false)
  }, [setTasks])

  useEffect(() => {
    void reload()
  }, [reload, userId])

  const createTask = useCallback(
    async (task: Task) => {
      const prev = tasksRef.current
      const order =
        prev.filter((t) => t.day === task.day).reduce((m, t) => Math.max(m, t.order), -1) + 1
      const korder =
        prev.filter((t) => t.status === task.status).reduce((m, t) => Math.max(m, t.korder), -1) + 1
      const full: Task = { ...task, order, korder }
      setTasks((p) => [...p, full])
      const { error: err } = await supabase.from('tasks').insert(taskToRow(full, userId))
      if (err) {
        setTasks(prev)
        setError(err.message)
      }
    },
    [setTasks, userId],
  )

  const updateTask = useCallback(
    async (task: Task) => {
      const prev = tasksRef.current
      setTasks((p) => p.map((t) => (t.id === task.id ? task : t)))
      const { error: err } = await supabase
        .from('tasks')
        .update(taskToRow(task, userId))
        .eq('id', task.id)
      if (err) {
        setTasks(prev)
        setError(err.message)
      }
    },
    [setTasks, userId],
  )

  const removeTask = useCallback(
    async (id: string) => {
      const prev = tasksRef.current
      setTasks((p) => p.filter((t) => t.id !== id))
      const { error: err } = await supabase.from('tasks').delete().eq('id', id)
      if (err) {
        setTasks(prev)
        setError(err.message)
      }
    },
    [setTasks],
  )

  const toggleDone = useCallback(
    async (id: string) => {
      const prev = tasksRef.current
      const { tasks: next } = applyToggleDone(prev, id)
      setTasks(next)
      const toggled = next.find((t) => t.id === id)
      if (!toggled) return
      const { error: err } = await supabase
        .from('tasks')
        .update(taskToRow(toggled, userId))
        .eq('id', id)
      if (err) {
        setTasks(prev)
        setError(err.message)
      }
    },
    [setTasks, userId],
  )

  const persistReorder = useCallback(
    async (next: Task[], containers: string[], mode: Mode) => {
      setTasks(next)
      const rows = next
        .filter((t) => containers.includes(mode === 'day' ? t.day : t.status))
        .map((t) => taskToRow(t, userId))
      if (rows.length === 0) return
      const { error: err } = await supabase.from('tasks').upsert(rows, { onConflict: 'id' })
      if (err) {
        setError(err.message)
        void reload() // resync from server after a failed reorder
      }
    },
    [setTasks, userId, reload],
  )

  return {
    tasks,
    loading,
    error,
    reload,
    setTasks,
    createTask,
    updateTask,
    removeTask,
    toggleDone,
    persistReorder,
  }
}
