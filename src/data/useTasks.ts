import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { supabase } from '../lib/supabase'
import { rowToTask, taskToRow } from './mappers'
import { applyToggleDone } from './selectors'
import { missingInstanceDates } from './recurrence'
import { newId } from '../lib/id'
import { addDays, parseDay, ymd } from '../lib/dates'
import { isTemplate, type Task } from '../types/task'
import type { Mode } from '../dnd/reorder'

export interface UseTasks {
  /** Board tasks only (non-recurring + materialized instances); templates are hidden. */
  tasks: Task[]
  loading: boolean
  error: string | null
  clearError: () => void
  reload: () => void
  setTasks: Dispatch<SetStateAction<Task[]>>
  createTask: (task: Task) => Promise<void>
  updateTask: (task: Task) => Promise<void>
  removeTask: (id: string) => Promise<void>
  toggleDone: (id: string) => Promise<void>
  persistReorder: (next: Task[], containers: string[], mode: Mode) => Promise<void>
  /** The hidden template for a parent id (to read a series' rule). */
  getTemplate: (parentId: string) => Task | undefined
  /** Apply an instance edit to the whole series from this occurrence forward. */
  updateSeries: (instance: Task, draft: Task) => Promise<void>
  /** Delete just this occurrence (skip-listed so it never regenerates). */
  deleteOccurrence: (instance: Task) => Promise<void>
  /** Delete this occurrence and all later ones (caps recur_until, or removes the series). */
  deleteSeriesFuture: (instance: Task) => Promise<void>
}

function makeInstance(tmpl: Task, day: string): Task {
  return {
    id: newId(),
    title: tmpl.title,
    description: tmpl.description,
    category: tmpl.category,
    color: tmpl.color,
    checklist: tmpl.checklist.map((c) => ({ id: newId(), text: c.text, done: false })),
    status: 'todo',
    done: false,
    day,
    order: 5000,
    korder: 5000,
    recurFreq: 'none',
    recurInterval: 1,
    recurUntil: null,
    recurParentId: tmpl.id,
    recurSkip: [],
  }
}

const instanceKey = (t: Task) => `${t.recurParentId}|${t.day}`

export function useTasks(userId: string): UseTasks {
  const [tasks, _setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const tasksRef = useRef<Task[]>([])
  const templatesRef = useRef<Task[]>([])
  const inFlight = useRef(false)

  const setTasks = useCallback<Dispatch<SetStateAction<Task[]>>>((update) => {
    _setTasks((prev) => {
      const next = typeof update === 'function' ? (update as (p: Task[]) => Task[])(prev) : update
      tasksRef.current = next
      return next
    })
  }, [])

  /** Insert any missing instances for the given templates within the rolling horizon. */
  const materialize = useCallback(
    async (templates: Task[]) => {
      const today = ymd(new Date())
      const board = tasksRef.current
      const instances: Task[] = []
      for (const tmpl of templates) {
        const existingDays = board.filter((t) => t.recurParentId === tmpl.id).map((t) => t.day)
        for (const day of missingInstanceDates(tmpl, existingDays, today)) {
          instances.push(makeInstance(tmpl, day))
        }
      }
      if (instances.length === 0) return
      // missingInstanceDates already excludes existing days, so these are all new; a plain insert
      // avoids ON CONFLICT (which can't target the partial unique index). The index still blocks
      // true duplicates at the DB level.
      setTasks((prev) => {
        const present = new Set(prev.filter((t) => t.recurParentId).map(instanceKey))
        return [...prev, ...instances.filter((i) => !present.has(instanceKey(i)))]
      })
      const { error: err } = await supabase
        .from('tasks')
        .insert(instances.map((t) => taskToRow(t, userId)))
      if (err) setError(err.message)
    },
    [setTasks, userId],
  )

  const reload = useCallback(async () => {
    // Guard against concurrent loads (notably React StrictMode's double-invoked effect),
    // which would materialize the same instances twice and hit the unique index.
    if (inFlight.current) return
    inFlight.current = true
    setLoading(true)
    setError(null)
    try {
      const { data, error: err } = await supabase.from('tasks').select('*')
      if (err) {
        setError(err.message)
        return
      }
      const all = (data ?? []).map(rowToTask)
      templatesRef.current = all.filter(isTemplate)
      setTasks(all.filter((t) => !isTemplate(t)))
      await materialize(templatesRef.current)
    } finally {
      setLoading(false)
      inFlight.current = false
    }
  }, [setTasks, materialize])

  useEffect(() => {
    void reload()
  }, [reload, userId])

  const createTask = useCallback(
    async (task: Task) => {
      if (isTemplate(task)) {
        templatesRef.current = [...templatesRef.current, task]
        const { error: err } = await supabase.from('tasks').insert(taskToRow(task, userId))
        if (err) {
          setError(err.message)
          return
        }
        await materialize([task])
        return
      }
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
    [setTasks, materialize, userId],
  )

  const updateTask = useCallback(
    async (task: Task) => {
      // Turning a normal task into a series: it becomes a hidden template.
      if (isTemplate(task)) {
        setTasks((prev) => prev.filter((t) => t.id !== task.id))
        templatesRef.current = [...templatesRef.current.filter((t) => t.id !== task.id), task]
        const { error: err } = await supabase
          .from('tasks')
          .update(taskToRow(task, userId))
          .eq('id', task.id)
        if (err) {
          setError(err.message)
          void reload()
          return
        }
        await materialize([task])
        return
      }
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
    [setTasks, materialize, reload, userId],
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
        void reload()
      }
    },
    [setTasks, userId, reload],
  )

  const clearError = useCallback(() => setError(null), [])

  const getTemplate = useCallback(
    (parentId: string) => templatesRef.current.find((t) => t.id === parentId),
    [],
  )

  const updateSeries = useCallback(
    async (instance: Task, draft: Task) => {
      const template = templatesRef.current.find((t) => t.id === instance.recurParentId)
      if (!template) return
      const cut = instance.day
      const next: Task = {
        ...template,
        title: draft.title,
        description: draft.description,
        category: draft.category,
        color: draft.color,
        checklist: draft.checklist,
        recurFreq: draft.recurFreq,
        recurInterval: draft.recurInterval,
        recurUntil: draft.recurUntil,
      }
      templatesRef.current = templatesRef.current.map((t) => (t.id === template.id ? next : t))
      // Propagate content to this + later instances.
      setTasks((prev) =>
        prev.map((t) =>
          t.recurParentId === template.id && t.day >= cut
            ? {
                ...t,
                title: draft.title,
                description: draft.description,
                category: draft.category,
                color: draft.color,
              }
            : t,
        ),
      )
      const rows = [
        taskToRow(next, userId),
        ...tasksRef.current
          .filter((t) => t.recurParentId === template.id && t.day >= cut)
          .map((t) => taskToRow(t, userId)),
      ]
      const { error: err } = await supabase.from('tasks').upsert(rows, { onConflict: 'id' })
      if (err) {
        setError(err.message)
        void reload()
        return
      }
      // If the rule shortened, drop now-out-of-range instances; then fill any new dates.
      if (next.recurUntil) {
        const until = next.recurUntil
        setTasks((prev) => prev.filter((t) => !(t.recurParentId === template.id && t.day > until)))
        await supabase.from('tasks').delete().eq('recur_parent_id', template.id).gt('day', until)
      }
      await materialize([next])
    },
    [setTasks, materialize, reload, userId],
  )

  const deleteOccurrence = useCallback(
    async (instance: Task) => {
      const template = templatesRef.current.find((t) => t.id === instance.recurParentId)
      if (template) {
        const next: Task = { ...template, recurSkip: [...template.recurSkip, instance.day] }
        templatesRef.current = templatesRef.current.map((t) => (t.id === template.id ? next : t))
        await supabase.from('tasks').update(taskToRow(next, userId)).eq('id', template.id)
      }
      await removeTask(instance.id)
    },
    [removeTask, userId],
  )

  const deleteSeriesFuture = useCallback(
    async (instance: Task) => {
      const template = templatesRef.current.find((t) => t.id === instance.recurParentId)
      if (!template) {
        await removeTask(instance.id)
        return
      }
      const cut = instance.day
      if (cut <= template.day) {
        // From the first occurrence onward = remove the whole series (cascade deletes instances).
        templatesRef.current = templatesRef.current.filter((t) => t.id !== template.id)
        setTasks((prev) => prev.filter((t) => t.recurParentId !== template.id))
        const { error: err } = await supabase.from('tasks').delete().eq('id', template.id)
        if (err) {
          setError(err.message)
          void reload()
        }
        return
      }
      const until = ymd(addDays(parseDay(cut), -1))
      const next: Task = { ...template, recurUntil: until }
      templatesRef.current = templatesRef.current.map((t) => (t.id === template.id ? next : t))
      setTasks((prev) => prev.filter((t) => !(t.recurParentId === template.id && t.day >= cut)))
      const { error: e1 } = await supabase
        .from('tasks')
        .update(taskToRow(next, userId))
        .eq('id', template.id)
      const { error: e2 } = await supabase
        .from('tasks')
        .delete()
        .eq('recur_parent_id', template.id)
        .gte('day', cut)
      if (e1 || e2) {
        setError((e1 ?? e2)!.message)
        void reload()
      }
    },
    [setTasks, removeTask, reload, userId],
  )

  return {
    tasks,
    loading,
    error,
    clearError,
    reload,
    setTasks,
    createTask,
    updateTask,
    removeTask,
    toggleDone,
    persistReorder,
    getTemplate,
    updateSeries,
    deleteOccurrence,
    deleteSeriesFuture,
  }
}
