import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { supabase } from '../lib/supabase'
import { errorMessage } from '../lib/errors'
import { rowToTask, taskToRow } from './mappers'
import { canPersistSnapshot, readBoardSnapshot, writeBoardSnapshot } from './snapshot'
import { applyRollForward, applyToggleDone } from './selectors'
import { applyTaskChange, payloadToChange } from './realtime'
import { useOwnWrites, useSyncedTable, type ChangePayload } from './useSyncedTable'
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
  /**
   * Move overdue tasks to today, appended to today's order (batched upsert). With `onlyIds`,
   * only overdue tasks in the set are moved (e.g. the currently-visible/filtered set);
   * omitted, every overdue task moves.
   */
  rollForward: (todayStr: string, onlyIds?: ReadonlySet<string>) => Promise<void>
  /** The hidden template for a parent id (to read a series' rule). */
  getTemplate: (parentId: string) => Task | undefined
  /** Apply an instance edit to the whole series from this occurrence forward. */
  updateSeries: (instance: Task, draft: Task) => Promise<void>
  /** Delete just this occurrence (skip-listed so it never regenerates). */
  deleteOccurrence: (instance: Task) => Promise<void>
  /** Delete this occurrence and all later ones (caps recur_until, or removes the series). */
  deleteSeriesFuture: (instance: Task) => Promise<void>
  /** True when the board is showing the last-known local snapshot instead of a live server load. */
  offline: boolean
  /** When that snapshot was taken (epoch ms), for the offline banner. Null when online. */
  savedAt: number | null
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
    atTime: tmpl.atTime,
    pinned: tmpl.pinned,
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

/**
 * `userId` is only a resolved id for *reading* — it may be the last-known id from
 * `readLastUserId()` with no live session behind it, which is what lets an offline boot look up
 * its snapshot. `hasSession` is the separate, stricter signal for *writing*: true only when there
 * is an actual authenticated session. The two diverge for a signed-out visitor whose session
 * vanished without a `SIGNED_OUT` event: `userId` stays non-empty while `hasSession` is false, and
 * a `reload()` in that state succeeds against RLS with `[]` and no error — a "successful" load
 * that authenticated nothing. See `hasLoadedFromServer` below.
 */
export function useTasks(userId: string, hasSession: boolean): UseTasks {
  const [tasks, _setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [offline, setOffline] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const tasksRef = useRef<Task[]>([])
  const templatesRef = useRef<Task[]>([])
  const inFlight = useRef(false)
  // Set true only by reload()'s success path, and only when that load actually happened under a
  // real session — never by hydrateFromSnapshot(), and never by a sessionless reload's empty
  // `{ data: [], error: null }` (RLS answering "nothing" is not the same as "board confirmed
  // empty"). Gates the snapshot writer so neither a failed load with no prior snapshot NOR an
  // unauthenticated-but-"successful" reload can write an empty board that then reads back as
  // "recently saved offline data" on the next boot, permanently masking the fact that we've never
  // actually talked to the server on this user's behalf.
  const hasLoadedFromServer = useRef(false)

  // Echo suppression for this client's own writes. The registry, the channel, the reconnect
  // backoff, and the tab/network catch-up all live in useSyncedTable now, shared with useSettings.
  const { markWrites, isOwnWrite } = useOwnWrites()

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
      // Browser-local on purpose, not the user's configured zone: this only anchors a 90-day
      // rolling materialization horizon, where a ±1-day shift at the far end is immaterial.
      // Threading the timezone in would re-run materialization whenever settings change, for
      // no behavioral gain — and a spurious re-run risks duplicate instance rows (23505).
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
      try {
        const { error: err } = await supabase
          .from('tasks')
          .insert(instances.map((t) => taskToRow(t, userId)))
        if (err) throw new Error(err.message)
      } catch (e) {
        setError(errorMessage(e))
      }
    },
    [setTasks, userId, markWrites],
  )

  /**
   * Fall back to the last-known board. Deliberately does NOT materialize: materialize()
   * inserts rows, and running it against snapshot-hydrated state on a flaky connection can
   * duplicate instances and hit tasks_recur_instance_uniq (23505). Offline is read-only, so
   * there is nothing to materialize for anyway.
   */
  const hydrateFromSnapshot = useCallback(() => {
    const snap = readBoardSnapshot(userId)
    if (!snap) return false
    templatesRef.current = snap.templates
    setTasks(snap.tasks)
    setSavedAt(snap.savedAt)
    setOffline(true)
    setError(null)
    return true
  }, [userId, setTasks])

  const reload = useCallback(async () => {
    // Signed out. `BoardPage` calls this hook before its own `if (!userId) return <Spinner/>`,
    // and the settings side has guarded this since it was hoisted above <Routes>; without it
    // every signed-out visitor fires a `tasks` select that RLS answers with `[]`.
    if (!userId) {
      setLoading(false)
      return
    }
    // Guard against concurrent loads (notably React StrictMode's double-invoked effect),
    // which would materialize the same instances twice and hit the unique index.
    if (inFlight.current) return
    inFlight.current = true
    setLoading(true)
    setError(null)
    try {
      const { data, error: err } = await supabase.from('tasks').select('*')
      if (err) {
        if (hydrateFromSnapshot()) return
        setError(err.message)
        return
      }
      const all = (data ?? []).map(rowToTask)
      templatesRef.current = all.filter(isTemplate)
      const instances = all.filter((t) => !isTemplate(t))
      if (hasSession) hasLoadedFromServer.current = true
      setOffline(false)
      setSavedAt(null)
      setTasks(instances)
      // Pass the freshly-loaded instances directly: tasksRef.current is not yet updated here.
      await materialize(templatesRef.current, instances)
    } catch (e) {
      // postgrest resolves fetch failures rather than throwing, so this is defensive: a future
      // .throwOnError() must not turn an offline boot into an unhandled rejection.
      if (hydrateFromSnapshot()) return
      setError(errorMessage(e))
    } finally {
      setLoading(false)
      inFlight.current = false
    }
  }, [userId, setTasks, materialize, hydrateFromSnapshot, hasSession])

  useEffect(() => {
    // `void reload()` runs reload's synchronous prefix (before its first `await`) inline, and
    // that prefix does call `setLoading(true)` and `setError(null)` — the rule is right that a
    // setState call happens during this effect's execution. It's safe here because that call
    // fires once, not in a loop: on the initial mount both are value-identical to the initial
    // `useState(true)` / `useState<string | null>(null)`, so React's Object.is bailout means
    // neither actually triggers a re-render; and `reload` is referentially stable — `setTasks`
    // and `markWrites` are `useCallback(…, [])`, `hydrateFromSnapshot` depends only on
    // `[userId, setTasks]` — so calling it can't change this effect's own dependencies and
    // re-fire it. Unlike useSettings.ts's disable of this same rule (which covers one direct
    // `setSettings(null)` call), this one blankets an entire async function: any new synchronous
    // setState added to reload()'s pre-await prefix is silently un-linted, so re-verify this
    // reasoning before adding one.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload()
  }, [reload, userId])

  // Persist the board for offline reads. Debounced because optimistic CRUD churns `tasks`;
  // a rolled-back write re-renders the restored state and the next tick writes that, so this
  // is self-correcting and needs no "confirmed" bookkeeping. Every clause of the gate — and why
  // `hasSession` is re-checked here rather than trusted through `hasLoadedFromServer` — is
  // documented on `canPersistSnapshot`, which useSettings uses too.
  useEffect(() => {
    if (
      !canPersistSnapshot({
        userId,
        hasSession,
        offline,
        loading,
        loadedFromServer: hasLoadedFromServer.current,
      })
    )
      return
    const id = window.setTimeout(() => {
      writeBoardSnapshot(userId, tasksRef.current, templatesRef.current)
    }, 1000)
    return () => window.clearTimeout(id)
  }, [userId, hasSession, offline, loading, tasks])

  // Live changes from other devices/sessions.
  const onRemoteChange = useCallback(
    (payload: ChangePayload) => {
      const change = payloadToChange(payload as RealtimePostgresChangesPayload<TaskRow>)
      if (!change) return
      // Functional update: bursts of events (a series creation is a template + many instance
      // frames before a render flush) must compose through React's queue — a value-form dispatch
      // computed from tasksRef would drop all but the first and last. Same-reference returns
      // still bail out of re-renders.
      setTasks((prevTasks) => {
        const prev = { tasks: prevTasks, templates: templatesRef.current }
        const next = applyTaskChange(prev, change)
        // Idempotent under StrictMode double-invoke (pure function of same inputs).
        templatesRef.current = next.templates
        return next.tasks
      })
    },
    [setTasks],
  )

  const stableReload = useCallback(() => void reload(), [reload])

  useSyncedTable({
    userId,
    table: 'tasks',
    primaryKey: 'id',
    reload: stableReload,
    onChange: onRemoteChange,
    isOwnWrite,
  })

  const createTask = useCallback(
    async (task: Task) => {
      if (isTemplate(task)) {
        templatesRef.current = [...templatesRef.current, task]
        markWrites([task.id])
        try {
          const { error: err } = await supabase.from('tasks').insert(taskToRow(task, userId))
          if (err) throw new Error(err.message)
        } catch (e) {
          setError(errorMessage(e))
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
      try {
        const { error: err } = await supabase.from('tasks').insert(taskToRow(full, userId))
        if (err) throw new Error(err.message)
      } catch (e) {
        setTasks(prev)
        setError(errorMessage(e))
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
        try {
          const { error: err } = await supabase
            .from('tasks')
            .update(taskToRow(task, userId))
            .eq('id', task.id)
          if (err) throw new Error(err.message)
        } catch (e) {
          setError(errorMessage(e))
          void reload()
          return
        }
        await materialize([task])
        return
      }
      const prev = tasksRef.current
      setTasks((p) => p.map((t) => (t.id === task.id ? task : t)))
      markWrites([task.id])
      try {
        const { error: err } = await supabase
          .from('tasks')
          .update(taskToRow(task, userId))
          .eq('id', task.id)
        if (err) throw new Error(err.message)
      } catch (e) {
        setTasks(prev)
        setError(errorMessage(e))
      }
    },
    [setTasks, materialize, reload, userId, markWrites],
  )

  const removeTask = useCallback(
    async (id: string) => {
      const prev = tasksRef.current
      setTasks((p) => p.filter((t) => t.id !== id))
      markWrites([id])
      try {
        const { error: err } = await supabase.from('tasks').delete().eq('id', id)
        if (err) throw new Error(err.message)
      } catch (e) {
        setTasks(prev)
        setError(errorMessage(e))
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
      try {
        const { error: err } = await supabase
          .from('tasks')
          .update(taskToRow(toggled, userId))
          .eq('id', id)
        if (err) throw new Error(err.message)
      } catch (e) {
        setTasks(prev)
        setError(errorMessage(e))
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
      try {
        const { error: err } = await supabase.from('tasks').upsert(rows, { onConflict: 'id' })
        if (err) throw new Error(err.message)
      } catch (e) {
        setError(errorMessage(e))
        void reload()
      }
    },
    [setTasks, userId, reload, markWrites],
  )

  const rollForward = useCallback(
    async (todayStr: string, onlyIds?: ReadonlySet<string>) => {
      const prev = tasksRef.current
      const { tasks: next, changed } = applyRollForward(prev, todayStr, onlyIds)
      if (changed.length === 0) return
      setTasks(next)
      markWrites(changed.map((t) => t.id))
      try {
        const { error: err } = await supabase.from('tasks').upsert(
          changed.map((t) => taskToRow(t, userId)),
          { onConflict: 'id' },
        )
        if (err) throw new Error(err.message)
      } catch (e) {
        setTasks(prev)
        setError(errorMessage(e))
      }
    },
    [setTasks, markWrites, userId],
  )

  const clearError = useCallback(() => setError(null), [])

  const getTemplate = useCallback(
    (parentId: string) => templatesRef.current.find((t) => t.id === parentId),
    [],
  )

  // The template-merge and future-instance field lists below carry only series-wide content
  // (title/description/category/color/atTime/checklist/recur*). Do NOT add `pinned`, `status`, or
  // `done` — those are per-occurrence and would get clobbered by a "this and all future" edit.
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
        atTime: draft.atTime,
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
                atTime: draft.atTime,
              }
            : t,
        ),
      )
      // Apply the edited content to each instance row directly. tasksRef.current still holds the
      // pre-edit instances here (the setTasks above updates it inside a deferred React updater), so
      // reading their content off the ref would persist the OLD title/description/category/color/
      // atTime and silently revert the edit on the next reload.
      const rows = [
        taskToRow(next, userId),
        ...tasksRef.current
          .filter((t) => t.recurParentId === template.id && isFromOccurrenceOnward(t, cut))
          .map((t) =>
            taskToRow(
              {
                ...t,
                title: draft.title,
                description: draft.description,
                category: draft.category,
                color: draft.color,
                atTime: draft.atTime,
              },
              userId,
            ),
          ),
      ]
      markWrites(rows.map((r) => r.id))
      try {
        const { error: err } = await supabase.from('tasks').upsert(rows, { onConflict: 'id' })
        if (err) throw new Error(err.message)
      } catch (e) {
        setError(errorMessage(e))
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
        try {
          const { error: err } = await supabase
            .from('tasks')
            .delete()
            .eq('recur_parent_id', template.id)
            .gt('recur_origin_day', until)
          if (err) throw new Error(err.message)
        } catch (e) {
          // Best-effort trim: the content edit above already persisted, and materialize()
          // below still needs to run regardless, so we don't roll back or return early here —
          // we only surface that this background persist may be out of sync (a reload can
          // resync it), instead of failing silently as before.
          console.error('Failed to delete trimmed instances after shortening series', e)
          setError(errorMessage(e))
        }
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
        try {
          const { error: err } = await supabase
            .from('tasks')
            .update(taskToRow(next, userId))
            .eq('id', template.id)
          if (err) throw new Error(err.message)
        } catch (e) {
          // Best-effort: the occurrence delete below still needs to run regardless, so we
          // don't roll back or skip that step here — we only surface that the recur-skip
          // persist may be out of sync (a reload can resync it), instead of failing silently
          // as before.
          console.error('Failed to persist skipped occurrence on template', e)
          setError(errorMessage(e))
        }
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
        try {
          const { error: err } = await supabase.from('tasks').delete().eq('id', template.id)
          if (err) throw new Error(err.message)
        } catch (e) {
          setError(errorMessage(e))
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
      // Both writes are independent (template cap + future-instance delete) and, as before,
      // each is always attempted regardless of the other's outcome; either failing (by a
      // resolved `{ error }` or a throw) surfaces the same combined error + reload.
      let err1: Error | null = null
      let err2: Error | null = null
      try {
        const { error } = await supabase
          .from('tasks')
          .update(taskToRow(next, userId))
          .eq('id', template.id)
        if (error) err1 = new Error(error.message)
      } catch (e) {
        err1 = e instanceof Error ? e : new Error(errorMessage(e))
      }
      try {
        const { error } = await supabase
          .from('tasks')
          .delete()
          .eq('recur_parent_id', template.id)
          .gte('recur_origin_day', cut)
        if (error) err2 = new Error(error.message)
      } catch (e) {
        err2 = e instanceof Error ? e : new Error(errorMessage(e))
      }
      if (err1 || err2) {
        setError((err1 ?? err2)!.message)
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
    rollForward,
    getTemplate,
    updateSeries,
    deleteOccurrence,
    deleteSeriesFuture,
    offline,
    savedAt,
  }
}
