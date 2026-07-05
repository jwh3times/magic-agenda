import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { supabase } from '../lib/supabase'
import { rowToTask, taskToRow } from './mappers'
import { applyToggleDone } from './selectors'
import { applyTaskChange, payloadToChange } from './realtime'
import { instanceOrigin, isFromOccurrenceOnward, missingInstances } from './recurrence'
import { newId } from '../lib/id'
import { addDays, parseDay, ymd } from '../lib/dates'
import { isTemplate, type Task } from '../types/task'
import type { Mode } from '../dnd/reorder'
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js'
import type { Database } from '../types/database.types'

type TaskRow = Database['public']['Tables']['tasks']['Row']

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
    recurOriginDay: day,
  }
}

// Identity is the occurrence the instance covers (its origin), not its mutable day — mirrors the
// (recur_parent_id, recur_origin_day) unique index and keeps the StrictMode double-insert guard sound.
const instanceKey = (t: Task) => `${t.recurParentId}|${instanceOrigin(t)}`

export function useTasks(userId: string): UseTasks {
  const [tasks, _setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const tasksRef = useRef<Task[]>([])
  const templatesRef = useRef<Task[]>([])
  const inFlight = useRef(false)

  // Ids this client just wrote, with expiry. Realtime echoes of our own writes are
  // skipped so they can't clobber newer optimistic state (e.g. during rapid drags).
  // Caveat (accepted): id-keyed suppression also drops a genuine edit to the same
  // task from another device inside the TTL — reload()/reconnect heals it.
  const ownWrites = useRef(new Map<string, number>())
  const OWN_WRITE_TTL_MS = 5000

  const markWrites = useCallback((ids: readonly (string | null | undefined)[]) => {
    const now = Date.now()
    for (const [id, exp] of ownWrites.current) if (exp < now) ownWrites.current.delete(id)
    for (const id of ids) if (id) ownWrites.current.set(id, now + OWN_WRITE_TTL_MS)
  }, [])

  const isOwnWrite = useCallback((id: string) => {
    const exp = ownWrites.current.get(id)
    return exp !== undefined && exp > Date.now()
  }, [])

  const setTasks = useCallback<Dispatch<SetStateAction<Task[]>>>((update) => {
    _setTasks((prev) => {
      const next = typeof update === 'function' ? (update as (p: Task[]) => Task[])(prev) : update
      tasksRef.current = next
      return next
    })
  }, [])

  /**
   * Insert any missing instances for the given templates within the rolling horizon. `board` is
   * the authoritative set of already-materialized instances to check against; a reload MUST pass
   * it explicitly. `tasksRef.current` is written inside a deferred React state updater, so right
   * after `setTasks(...)` it can still hold the pre-load value (empty on a fresh mount) — reading
   * it there makes every occurrence look missing and re-inserts rows that already exist (23505 on
   * tasks_recur_instance_uniq). The ref default is safe only for incremental callers that did not
   * just replace the whole board.
   */
  const materialize = useCallback(
    async (templates: Task[], board: Task[] = tasksRef.current) => {
      const today = ymd(new Date())
      const instances: Task[] = []
      for (const tmpl of templates) {
        // Match existing instances to occurrences by origin, so an instance dragged to another day
        // still counts as covering its origin date and is not resurrected as a duplicate there.
        const existing = board.filter((t) => t.recurParentId === tmpl.id)
        for (const day of missingInstances(tmpl, existing, today)) {
          instances.push(makeInstance(tmpl, day))
        }
      }
      if (instances.length === 0) return
      // missingInstances already excludes covered occurrences, so these are all new; a plain insert
      // avoids ON CONFLICT (which can't target the partial unique index). The index still blocks
      // true duplicates at the DB level.
      setTasks((prev) => {
        const present = new Set(prev.filter((t) => t.recurParentId).map(instanceKey))
        return [...prev, ...instances.filter((i) => !present.has(instanceKey(i)))]
      })
      markWrites(instances.map((i) => i.id))
      const { error: err } = await supabase
        .from('tasks')
        .insert(instances.map((t) => taskToRow(t, userId)))
      if (err) setError(err.message)
    },
    [setTasks, userId, markWrites],
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
      const instances = all.filter((t) => !isTemplate(t))
      setTasks(instances)
      // Pass the freshly-loaded instances directly: tasksRef.current is not yet updated here.
      await materialize(templatesRef.current, instances)
    } finally {
      setLoading(false)
      inFlight.current = false
    }
  }, [setTasks, materialize])

  useEffect(() => {
    void reload()
  }, [reload, userId])

  // Live changes from other devices/sessions. Sub-epoch bumps force a fresh
  // channel after an error (with backoff); reload() covers anything missed.
  const [subEpoch, setSubEpoch] = useState(0)
  const retries = useRef(0)

  useEffect(() => {
    if (!userId) return
    let disposed = false
    const channel = supabase
      .channel(`tasks-${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tasks', filter: `user_id=eq.${userId}` },
        (payload) => {
          const change = payloadToChange(payload as RealtimePostgresChangesPayload<TaskRow>)
          if (!change) return
          const id = change.type === 'DELETE' ? change.id : change.task.id
          if (isOwnWrite(id)) return
          // Functional update: bursts of events (a series creation is a template +
          // many instance frames before a render flush) must compose through React's
          // queue — a value-form dispatch computed from tasksRef would drop all but
          // the first and last. Same-reference returns still bail out of re-renders.
          setTasks((prevTasks) => {
            const prev = { tasks: prevTasks, templates: templatesRef.current }
            const next = applyTaskChange(prev, change)
            // Idempotent under StrictMode double-invoke (pure function of same inputs).
            templatesRef.current = next.templates
            return next.tasks
          })
        },
      )
      .subscribe((status) => {
        if (disposed) return
        if (status === 'SUBSCRIBED') {
          retries.current = 0
          return
        }
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          const backoff = Math.min(30_000, 1000 * 2 ** retries.current++)
          void reload()
          window.setTimeout(() => {
            if (!disposed) setSubEpoch((e) => e + 1)
          }, backoff)
        }
      })
    return () => {
      disposed = true
      void supabase.removeChannel(channel)
    }
  }, [userId, subEpoch, isOwnWrite, reload, setTasks])

  // Mobile Safari (and other browsers) kill background sockets aggressively —
  // catch up on anything missed when the tab regains focus or connectivity returns.
  useEffect(() => {
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
  }, [reload])

  const createTask = useCallback(
    async (task: Task) => {
      if (isTemplate(task)) {
        templatesRef.current = [...templatesRef.current, task]
        markWrites([task.id])
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
      markWrites([full.id])
      const { error: err } = await supabase.from('tasks').insert(taskToRow(full, userId))
      if (err) {
        setTasks(prev)
        setError(err.message)
      }
    },
    [setTasks, materialize, userId, markWrites],
  )

  const updateTask = useCallback(
    async (task: Task) => {
      // Turning a normal task into a series: it becomes a hidden template.
      if (isTemplate(task)) {
        setTasks((prev) => prev.filter((t) => t.id !== task.id))
        templatesRef.current = [...templatesRef.current.filter((t) => t.id !== task.id), task]
        markWrites([task.id])
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
      markWrites([task.id])
      const { error: err } = await supabase
        .from('tasks')
        .update(taskToRow(task, userId))
        .eq('id', task.id)
      if (err) {
        setTasks(prev)
        setError(err.message)
      }
    },
    [setTasks, materialize, reload, userId, markWrites],
  )

  const removeTask = useCallback(
    async (id: string) => {
      const prev = tasksRef.current
      setTasks((p) => p.filter((t) => t.id !== id))
      markWrites([id])
      const { error: err } = await supabase.from('tasks').delete().eq('id', id)
      if (err) {
        setTasks(prev)
        setError(err.message)
      }
    },
    [setTasks, markWrites],
  )

  const toggleDone = useCallback(
    async (id: string) => {
      const prev = tasksRef.current
      const { tasks: next } = applyToggleDone(prev, id)
      setTasks(next)
      const toggled = next.find((t) => t.id === id)
      if (!toggled) return
      markWrites([id])
      const { error: err } = await supabase
        .from('tasks')
        .update(taskToRow(toggled, userId))
        .eq('id', id)
      if (err) {
        setTasks(prev)
        setError(err.message)
      }
    },
    [setTasks, userId, markWrites],
  )

  const persistReorder = useCallback(
    async (next: Task[], containers: string[], mode: Mode) => {
      setTasks(next)
      const rows = next
        .filter((t) => containers.includes(mode === 'day' ? t.day : t.status))
        .map((t) => taskToRow(t, userId))
      if (rows.length === 0) return
      markWrites(rows.map((r) => r.id))
      const { error: err } = await supabase.from('tasks').upsert(rows, { onConflict: 'id' })
      if (err) {
        setError(err.message)
        void reload()
      }
    },
    [setTasks, userId, reload, markWrites],
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
      // "This and all future" is scoped by the edited occurrence's origin, not its movable day, so a
      // dragged card still edits the right occurrences (matches the origin-based materialize).
      const cut = instanceOrigin(instance)
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
          t.recurParentId === template.id && isFromOccurrenceOnward(t, cut)
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
          .filter((t) => t.recurParentId === template.id && isFromOccurrenceOnward(t, cut))
          .map((t) => taskToRow(t, userId)),
      ]
      markWrites(rows.map((r) => r.id))
      const { error: err } = await supabase.from('tasks').upsert(rows, { onConflict: 'id' })
      if (err) {
        setError(err.message)
        void reload()
        return
      }
      // If the rule shortened, drop instances whose occurrence (origin) now falls past the end.
      if (next.recurUntil) {
        const until = next.recurUntil
        markWrites(
          tasksRef.current
            .filter((t) => t.recurParentId === template.id && instanceOrigin(t) > until)
            .map((t) => t.id),
        )
        setTasks((prev) =>
          prev.filter((t) => !(t.recurParentId === template.id && instanceOrigin(t) > until)),
        )
        await supabase
          .from('tasks')
          .delete()
          .eq('recur_parent_id', template.id)
          .gt('recur_origin_day', until)
      }
      await materialize([next])
    },
    [setTasks, materialize, reload, userId, markWrites],
  )

  const deleteOccurrence = useCallback(
    async (instance: Task) => {
      const template = templatesRef.current.find((t) => t.id === instance.recurParentId)
      markWrites([template?.id, instance.id])
      if (template) {
        // Skip the occurrence by its origin date (not the possibly-moved day) so it never regenerates.
        const next: Task = {
          ...template,
          recurSkip: [...template.recurSkip, instanceOrigin(instance)],
        }
        templatesRef.current = templatesRef.current.map((t) => (t.id === template.id ? next : t))
        await supabase.from('tasks').update(taskToRow(next, userId)).eq('id', template.id)
      }
      await removeTask(instance.id)
    },
    [removeTask, userId, markWrites],
  )

  const deleteSeriesFuture = useCallback(
    async (instance: Task) => {
      const template = templatesRef.current.find((t) => t.id === instance.recurParentId)
      if (!template) {
        await removeTask(instance.id)
        return
      }
      // Scope by the edited occurrence's origin, not its movable day, so a dragged card trims the
      // series at the right occurrence (and can't false-trigger the whole-series branch below).
      const cut = instanceOrigin(instance)
      markWrites([
        template.id,
        ...tasksRef.current
          .filter((t) => t.recurParentId === template.id && isFromOccurrenceOnward(t, cut))
          .map((t) => t.id),
      ])
      if (cut <= template.day) {
        // From the first occurrence onward = remove the whole series (cascade deletes instances).
        templatesRef.current = templatesRef.current.filter((t) => t.id !== template.id)
        markWrites([
          template.id,
          ...tasksRef.current.filter((t) => t.recurParentId === template.id).map((t) => t.id),
        ])
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
      setTasks((prev) =>
        prev.filter((t) => !(t.recurParentId === template.id && isFromOccurrenceOnward(t, cut))),
      )
      const { error: e1 } = await supabase
        .from('tasks')
        .update(taskToRow(next, userId))
        .eq('id', template.id)
      const { error: e2 } = await supabase
        .from('tasks')
        .delete()
        .eq('recur_parent_id', template.id)
        .gte('recur_origin_day', cut)
      if (e1 || e2) {
        setError((e1 ?? e2)!.message)
        void reload()
      }
    },
    [setTasks, removeTask, reload, userId, markWrites],
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
