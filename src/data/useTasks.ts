import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react'
import { supabase } from '../lib/supabase'
import { errorMessage } from '../lib/errors'
import { rowToTask, taskToRow } from './mappers'
import { canPersistSnapshot, readBoardSnapshot, writeBoardSnapshot } from './snapshot'
import { applyRollForward, applyToggleDone } from './selectors'
import { applyTaskChange, payloadToChange } from './realtime'
import { useOwnWrites, useSyncedTable, type ChangePayload } from './useSyncedTable'
import {
  instanceKey,
  pendingInstances,
  planDeleteOccurrence,
  planDeleteSeriesFrom,
  planEditSeriesFrom,
  planEndSeriesAt,
  planPromoteToSeries,
  resolveDelete,
  resolveSave,
  type DeletionTarget,
  type FailureHandling,
  type RecurScope,
  type SeriesPlan,
} from './series'
import { newId } from '../lib/id'
import { ymd } from '../lib/dates'
import { isSeriesDefinition, type SeriesDefinition, type Task, type TaskDraft } from '../types/task'
import type { Mode } from '../dnd/reorder'
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js'
import type { Database } from '../types/database.types'
import type { TaskBoard } from './taskBoardContext'

type TaskRow = Database['public']['Tables']['tasks']['Row']

/** Runs one planned deletion. The only place a `DeletionTarget` becomes a query. */
async function runDeletion(target: DeletionTarget): Promise<void> {
  const del = supabase.from('tasks').delete()
  if (target.by === 'id') {
    const { error } = await del.eq('id', target.id)
    if (error) throw new Error(error.message)
    return
  }
  const scoped = del.eq('recur_parent_id', target.parentId)
  const { error } =
    target.by === 'occurrence-after'
      ? await scoped.gt('recur_origin_day', target.day)
      : await scoped.gte('recur_origin_day', target.day)
  if (error) throw new Error(error.message)
}

export interface UseTasks extends TaskBoard {
  loading: boolean
  error: string | null
  clearError: () => void
  reload: () => Promise<void>
  createTask: (task: Task) => Promise<void>
  updateTask: (task: Task) => Promise<void>
  removeTask: (id: string) => Promise<void>
  /** True when the board is showing the last-known local snapshot instead of a live server load. */
  offline: boolean
  /** When that snapshot was taken (epoch ms), for the offline banner. Null when online. */
  savedAt: number | null
}

/**
 * `userId` is only a resolved id for *reading* — it may be the last-known id from
 * `readLastUserId()` with no live session behind it, which is what lets an offline boot look up
 * its snapshot. `hasSession` is the separate, stricter signal for *writing*: true only when there
 * is an actual authenticated session. The two diverge for a signed-out visitor whose session
 * vanished without a `SIGNED_OUT` event: `userId` stays non-empty while `hasSession` is false, and
 * a `reload()` in that state succeeds against RLS with `[]` and no error — a "successful" load
 * that authenticated nothing. See `hasLoadedFromServer` below.
 */
export function useTasks(userId: string, boardId: string, hasSession: boolean): UseTasks {
  const [tasks, _setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [offline, setOffline] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [templatesVersion, bumpTemplatesVersion] = useReducer((version: number) => version + 1, 0)
  const tasksRef = useRef<Task[]>([])
  const templatesRef = useRef<SeriesDefinition[]>([])
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
      const next = typeof update === 'function' ? update(prev) : update
      tasksRef.current = next
      return next
    })
  }, [])

  const previewReorder = useCallback((next: Task[]) => setTasks(next), [setTasks])

  /**
   * Insert any missing instances for the given templates within the rolling horizon.
   *
   * `board` is the authoritative set of already-materialized instances to check against, and it is
   * **required** — `pendingInstances` has no default to take. `tasksRef.current` is written inside
   * a deferred React state updater, so right after `setTasks(...)` it can still hold the pre-load
   * value (empty on a fresh mount); passing that makes every occurrence look missing and
   * re-inserts rows that already exist (23505 on tasks_recur_instance_uniq). This used to default
   * to the ref, and three of its four call sites took that default.
   */
  const materialize = useCallback(
    async (templates: Task[], board: Task[]) => {
      // Browser-local on purpose, not the user's configured zone. Threading the timezone in would
      // re-run materialization whenever settings change, and a spurious re-run risks duplicate
      // instance rows (23505). Since #210 this clock sets the *lower* bound of the window as well
      // as the horizon end, so a ±1-day shift is no longer immaterial at both ends — a board
      // whose zone is behind the browser's would drop its current Occurrence below the floor.
      // `MATERIALIZE_GRACE_DAYS` in recurrence.ts absorbs exactly that, which is what keeps this
      // call site on the cheap clock.
      const instances = pendingInstances(templates, board, ymd(new Date()), newId)
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
          .insert(instances.map((t) => taskToRow(t, boardId)))
        if (err) throw new Error(err.message)
      } catch (e) {
        setError(errorMessage(e))
      }
    },
    [setTasks, boardId, markWrites],
  )

  /**
   * Fall back to the last-known board. Deliberately does NOT materialize: materialize()
   * inserts rows, and running it against snapshot-hydrated state on a flaky connection can
   * duplicate instances and hit tasks_recur_instance_uniq (23505). Offline is read-only, so
   * there is nothing to materialize for anyway.
   */
  const hydrateFromSnapshot = useCallback(() => {
    const snap = readBoardSnapshot(userId, boardId)
    if (!snap) return false
    templatesRef.current = snap.templates
    bumpTemplatesVersion()
    setTasks(snap.tasks)
    setSavedAt(snap.savedAt)
    setOffline(true)
    setError(null)
    return true
  }, [userId, boardId, setTasks])

  const reload = useCallback(async () => {
    // Signed out. `BoardPage` calls this hook before its own `if (!userId) return <Spinner/>`,
    // and the settings side has guarded this since it was hoisted above <Routes>; without it
    // every signed-out visitor fires a `tasks` select that RLS answers with `[]`.
    // `!boardId` is the same shape of guard for the same reason: the Board Directory resolves
    // asynchronously, so this hook mounts with no Board selected. An unfiltered load in that window
    // would fetch every task the account owns across every Board — which is precisely the
    // "unfiltered production task load" this phase exists to make impossible.
    if (!userId || !boardId) {
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
      const { data, error: err } = await supabase.from('tasks').select('*').eq('board_id', boardId)
      if (err) {
        if (hydrateFromSnapshot()) return
        setError(err.message)
        return
      }
      const all = (data ?? []).map(rowToTask)
      templatesRef.current = all.filter(isSeriesDefinition)
      bumpTemplatesVersion()
      const instances = all.filter((t) => !isSeriesDefinition(t))
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
  }, [userId, boardId, setTasks, materialize, hydrateFromSnapshot, hasSession])

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
    // oxlint-disable-next-line react/set-state-in-effect
    void reload()
  }, [reload])

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
      writeBoardSnapshot(userId, boardId, tasksRef.current, templatesRef.current)
    }, 1000)
    return () => window.clearTimeout(id)
    // Visible Tasks and hidden Series definitions are independent debounce triggers. The callback
    // reads their coherent pair from refs after either changes.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [userId, boardId, hasSession, offline, loading, tasks, templatesVersion])

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
      bumpTemplatesVersion()
    },
    [setTasks],
  )

  useSyncedTable({
    userId,
    table: 'tasks',
    primaryKey: 'id',
    // Board-scoped, not account-scoped: this client only shows one Board, and after the
    // authorization cutover `board_id` is also what the server uses to decide visibility.
    // DELETE events remain unfilterable and fan out regardless, which is why the reducer treats
    // an unknown id as a no-op.
    filterColumn: 'board_id',
    filterValue: boardId,
    reload,
    onChange: onRemoteChange,
    isOwnWrite,
  })

  const createTask = useCallback(
    async (task: Task) => {
      if (isSeriesDefinition(task)) {
        templatesRef.current = [...templatesRef.current, task]
        bumpTemplatesVersion()
        markWrites([task.id])
        try {
          const { error: err } = await supabase.from('tasks').insert(taskToRow(task, boardId))
          if (err) throw new Error(err.message)
        } catch (e) {
          setError(errorMessage(e))
          return
        }
        // The board is unchanged by adding a template (templates are never in it).
        await materialize([task], tasksRef.current)
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
        const { error: err } = await supabase.from('tasks').insert(taskToRow(full, boardId))
        if (err) throw new Error(err.message)
      } catch (e) {
        setTasks(prev)
        setError(errorMessage(e))
      }
    },
    [setTasks, materialize, boardId, markWrites],
  )

  /**
   * Update one board Task in place.
   *
   * Adding a Recurrence Rule is deliberately NOT handled here. It used to be — the row was turned
   * into the hidden template and materialization produced a fresh first Occurrence — and that lost
   * the user's status, checklist progress, and position (#206). `resolveSave` now routes it to
   * `planPromoteToSeries`, so the decision lives with every other series decision.
   */
  const updateTask = useCallback(
    async (task: Task) => {
      const prev = tasksRef.current
      setTasks((p) => p.map((t) => (t.id === task.id ? task : t)))
      markWrites([task.id])
      try {
        const { error: err } = await supabase
          .from('tasks')
          .update(taskToRow(task, boardId))
          .eq('id', task.id)
        if (err) throw new Error(err.message)
      } catch (e) {
        setTasks(prev)
        setError(errorMessage(e))
      }
    },
    [setTasks, boardId, markWrites],
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
          .update(taskToRow(toggled, boardId))
          .eq('id', id)
        if (err) throw new Error(err.message)
      } catch (e) {
        setTasks(prev)
        setError(errorMessage(e))
      }
    },
    [setTasks, boardId, markWrites],
  )

  const persistReorder = useCallback(
    async (next: Task[], containers: string[], mode: Mode) => {
      setTasks(next)
      const rows = next
        .filter((t) => containers.includes(mode === 'day' ? t.day : t.status))
        .map((t) => taskToRow(t, boardId))
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
    [setTasks, boardId, reload, markWrites],
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
          changed.map((t) => taskToRow(t, boardId)),
          { onConflict: 'id' },
        )
        if (err) throw new Error(err.message)
      } catch (e) {
        setTasks(prev)
        setError(errorMessage(e))
      }
    },
    [setTasks, markWrites, boardId],
  )

  const clearError = useCallback(() => setError(null), [])

  const getTemplate = useCallback(
    (parentId: string) => templatesRef.current.find((t) => t.id === parentId),
    [],
  )

  /**
   * Execute a series plan: optimistic state first, then the writes.
   *
   * Every decision lives in `series.ts`; this knows only how to talk to Supabase and how to honour
   * each step's `FailureHandling`. Steps run in order — upserts, then deletions — and an `abort`
   * stops the rest, which is what keeps a failed content upsert from trimming a series down to a
   * rule that never persisted.
   */
  const runPlan = useCallback(
    async (plan: SeriesPlan) => {
      const prevTasks = tasksRef.current
      const prevTemplates = templatesRef.current
      markWrites(plan.markIds)
      templatesRef.current = [...plan.state.templates]
      bumpTemplatesVersion()
      setTasks([...plan.state.tasks])

      // An object rather than a bare `let`: TypeScript narrows a captured `let` to its initial
      // literal type inside the closure below, which would make the comparisons unreachable.
      const outcome = { recover: 'none' as FailureHandling['recover'], aborted: false }
      const failed = (e: unknown, handling: FailureHandling) => {
        setError(errorMessage(e))
        // 'reload' outranks 'rollback': once any write may have landed, restoring the pre-plan
        // state is a guess, whereas resyncing from the server is always correct.
        if (handling.recover === 'reload') outcome.recover = 'reload'
        else if (handling.recover === 'rollback' && outcome.recover === 'none')
          outcome.recover = 'rollback'
        if (handling.abort) outcome.aborted = true
      }

      if (plan.upserts.length > 0) {
        try {
          const { error: err } = await supabase.from('tasks').upsert(
            plan.upserts.map((t) => taskToRow(t, boardId)),
            { onConflict: 'id' },
          )
          if (err) throw new Error(err.message)
        } catch (e) {
          failed(e, plan.upsertOnFailure)
        }
      }

      for (const deletion of plan.deletions) {
        if (outcome.aborted) break
        try {
          await runDeletion(deletion.target)
        } catch (e) {
          failed(e, deletion.onFailure)
        }
      }

      if (outcome.recover === 'reload') void reload()
      else if (outcome.recover === 'rollback') {
        templatesRef.current = prevTemplates
        bumpTemplatesVersion()
        setTasks(prevTasks)
      }

      // Pass the plan's own board rather than the ref: `setTasks` writes the ref inside a
      // deferred React updater, so the ref may still hold the pre-plan value here.
      if (!outcome.aborted && outcome.recover === 'none' && plan.materialize.length > 0) {
        await materialize(plan.materialize, [...plan.state.tasks])
      }
    },
    [setTasks, markWrites, boardId, reload, materialize],
  )

  const seriesState = useCallback(
    () => ({ tasks: tasksRef.current, templates: templatesRef.current }),
    [],
  )

  const saveTask = useCallback(
    async (orig: TaskDraft | null, draft: TaskDraft, isNew: boolean, scope?: RecurScope) => {
      const op = resolveSave(orig, draft, isNew, scope)
      if (op.kind === 'create') return createTask(op.task)
      if (op.kind === 'promote-to-series') {
        const plan = planPromoteToSeries(seriesState(), op.task, newId)
        // A draft with no Rule does not describe a Series; `resolveSave` never routes one here.
        if (plan) await runPlan(plan)
        return
      }
      if (op.kind === 'end-series-at') {
        return runPlan(planEndSeriesAt(seriesState(), op.instance, op.draft))
      }
      if (op.kind === 'update-series-from') {
        const plan = planEditSeriesFrom(seriesState(), op.instance, op.draft)
        // No template means the series is gone; there is nothing coherent to edit "from here on".
        if (plan) await runPlan(plan)
        return
      }
      // 'update-plain' and 'update-occurrence' differ only in the task `resolveSave` produced.
      return updateTask(op.task)
    },
    [createTask, updateTask, runPlan, seriesState],
  )

  const deleteTask = useCallback(
    async (id: string, scope?: RecurScope) => {
      const task = tasksRef.current.find((t) => t.id === id)
      // Already gone — from another device, or a double-click. The row is deleted either way.
      if (!task) return
      const op = resolveDelete(task, scope)
      if (op.kind === 'delete-plain') return removeTask(op.id)
      const plan =
        op.kind === 'delete-occurrence'
          ? planDeleteOccurrence(seriesState(), op.instance)
          : planDeleteSeriesFrom(seriesState(), op.instance)
      await runPlan(plan)
    },
    [removeTask, runPlan, seriesState],
  )

  return {
    tasks,
    loading,
    error,
    clearError,
    reload,
    previewReorder,
    createTask,
    updateTask,
    removeTask,
    toggleDone,
    persistReorder,
    rollForward,
    getTemplate,
    saveTask,
    deleteTask,
    offline,
    savedAt,
  }
}
