import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { supabase } from '../lib/supabase'
import { useBoardDirectoryContext, useBoardSession } from '../board/BoardDirectoryProvider'
import { useSettingsContext } from '../data/SettingsProvider'
import { useToday } from '../data/todayContext'
import { loadBoardTasks } from '../data/loadBoardTasks'
import { rowToTask, taskToRow } from '../data/mappers'
import { archiveDecision } from '../data/completion'
import { applyToggleCompletion } from '../data/selectors'
import { completionStreak, historyWeeks, throughputWeeks, type HistoryEntry } from '../data/history'
import { chipLabel, formatWeekRange, parseDay } from '../lib/dates'
import { isTemplate, type Task } from '../types/task'

type Action = 'archive' | 'unarchive' | 'reopen'

/**
 * Settings → History: the selected Board's Completion History, its Archive controls, and
 * current-state statistics.
 *
 * It loads the Board itself rather than borrowing `useTasks`, which is deliberately not hoisted
 * above `<Routes>` (it would drag dnd-kit and the board data layer into the entry chunk). The read
 * is `loadBoardTasks`, the same complete, count-checked reader the board and export use, so a
 * silently capped page cannot make History under-report.
 *
 * Every write re-selects its row and keeps the database's answer. The lifecycle trigger stamps the
 * first Archive and overrules a supplied instant, so the optimistic value is only ever a guess.
 */
export function HistorySection() {
  const { selectedBoardId } = useBoardDirectoryContext()
  const { can } = useBoardSession()
  const { settings } = useSettingsContext()
  const today = useToday()
  const boardId = selectedBoardId ?? ''
  const timezone = settings?.timezone ?? null
  const weekStart = settings?.weekStart ?? 0

  // Keyed by the Board it was read for, so switching Boards reads as loading without an effect
  // having to reset anything synchronously — and a slow read for the previous Board can never be
  // shown under the new one's name.
  const [loaded, setLoaded] = useState<{ boardId: string; tasks: Task[] | null } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)

  useEffect(() => {
    if (!boardId) return
    let cancelled = false
    void loadBoardTasks(boardId)
      .then(({ data, error: err }) => ({
        boardId,
        tasks: err ? null : (data ?? []).map(rowToTask).filter((task) => !isTemplate(task)),
      }))
      .catch(() => ({ boardId, tasks: null }))
      .then((result) => {
        if (!cancelled) setLoaded(result)
      })
    return () => {
      cancelled = true
    }
  }, [boardId])

  const current = loaded?.boardId === boardId ? loaded : null
  const tasks = useMemo(() => current?.tasks ?? [], [current])
  const setTasks = (update: (prev: Task[]) => Task[]) =>
    setLoaded((prev) => (prev && prev.tasks ? { ...prev, tasks: update(prev.tasks) } : prev))

  const weeks = useMemo(
    () => historyWeeks(tasks, timezone, weekStart),
    [tasks, timezone, weekStart],
  )
  const throughput = useMemo(
    () => throughputWeeks(tasks, today, timezone, weekStart),
    [tasks, today, timezone, weekStart],
  )
  const streak = useMemo(() => completionStreak(tasks, today, timezone), [tasks, today, timezone])

  const act = async (id: string, action: Action) => {
    if (!can.editContent || pendingId) return
    const now = new Date().toISOString()
    // Reopen goes through the same selector as the board's quick action, so the Task lands at the
    // bottom of its destination Kanban column rather than at a stale position from months ago.
    const next =
      action === 'reopen'
        ? applyToggleCompletion(tasks, id, now).tasks.find((task) => task.id === id)
        : (() => {
            const current = tasks.find((task) => task.id === id)
            return current && { ...current, ...archiveDecision(current, action, now) }
          })()
    if (!next) return
    setPendingId(id)
    setError(null)
    try {
      const { data, error: err } = await supabase
        .from('tasks')
        .update(taskToRow(next, boardId))
        .eq('id', id)
        .select()
      if (err) throw new Error(err.message)
      const saved = data?.[0] ? rowToTask(data[0]) : next
      setTasks((prev) => prev.map((task) => (task.id === id ? saved : task)))
    } catch {
      setError('Could not save that change. Please try again.')
    } finally {
      setPendingId(null)
    }
  }

  if (!boardId) return <p style={muted}>Select a Board to see its history.</p>
  if (!current) return <p style={muted}>Loading history…</p>
  if (!current.tasks) {
    return (
      <p role="alert" style={muted}>
        Could not load this Board&apos;s history. Check your connection and reopen Settings.
      </p>
    )
  }

  const peak = Math.max(1, ...throughput.map((week) => week.count))
  const readOnly = !can.editContent

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {error && (
        <p role="alert" style={{ margin: 0, fontWeight: 600 }}>
          {error}
        </p>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'flex-end' }}>
        <div>
          <div style={muted}>Completion streak</div>
          <div style={{ fontSize: 26, fontWeight: 700 }} data-testid="completion-streak">
            {streak} {streak === 1 ? 'day' : 'days'}
          </div>
        </div>

        <figure style={{ margin: 0, flex: '1 1 260px' }}>
          <figcaption style={muted}>Completed per week, last {throughput.length} weeks</figcaption>
          <ol
            aria-label="Weekly throughput"
            style={{
              listStyle: 'none',
              margin: '6px 0 0',
              padding: 0,
              display: 'flex',
              gap: 4,
              alignItems: 'flex-end',
              height: 72,
            }}
          >
            {throughput.map((week) => (
              <li
                key={week.weekStart}
                aria-label={`Week of ${chipLabel(week.weekStart)}: ${week.count} completed`}
                title={`Week of ${chipLabel(week.weekStart)}: ${week.count}`}
                style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    display: 'block',
                    width: '100%',
                    height: `${Math.round((week.count / peak) * 56)}px`,
                    minHeight: week.count > 0 ? 3 : 1,
                    background: 'currentColor',
                    opacity: week.count > 0 ? 0.75 : 0.2,
                    borderRadius: 2,
                  }}
                />
                <span aria-hidden="true" style={{ fontSize: 11, marginTop: 2 }}>
                  {week.count}
                </span>
              </li>
            ))}
          </ol>
        </figure>
      </div>

      {weeks.length === 0 ? (
        <p style={muted}>No completed tasks on this Board yet.</p>
      ) : (
        weeks.map((week) => (
          <section
            key={week.weekStart}
            aria-label={`Week of ${formatWeekRange(parseDay(week.weekStart))}`}
          >
            <h3 style={{ margin: '0 0 6px', fontSize: 14 }}>
              {formatWeekRange(parseDay(week.weekStart))}
            </h3>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
              {week.entries.map((entry) => (
                <HistoryRow
                  key={entry.task.id}
                  entry={entry}
                  readOnly={readOnly}
                  busy={pendingId !== null}
                  onAction={(action) => void act(entry.task.id, action)}
                />
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  )
}

function HistoryRow({
  entry,
  readOnly,
  busy,
  onAction,
}: {
  entry: HistoryEntry
  readOnly: boolean
  busy: boolean
  onAction: (action: Action) => void
}) {
  const { task, archived, day } = entry
  return (
    <li
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 8,
        opacity: archived ? 0.75 : 1,
      }}
    >
      <span style={{ flex: '1 1 160px', fontWeight: 600 }}>{task.title || 'Untitled task'}</span>
      <span style={{ fontSize: 12, opacity: 0.7 }}>{chipLabel(day)}</span>
      {/* Status is text, not colour alone, so Archived vs active Completed survives any theme. */}
      <span style={badge}>{archived ? 'Archived' : 'Completed'}</span>
      {!readOnly && (
        <>
          <button
            type="button"
            style={btn}
            disabled={busy}
            onClick={() => onAction(archived ? 'unarchive' : 'archive')}
            aria-label={`${archived ? 'Unarchive' : 'Archive'} ${task.title}`}
          >
            {archived ? 'Unarchive' : 'Archive'}
          </button>
          <button
            type="button"
            style={btn}
            disabled={busy}
            onClick={() => onAction('reopen')}
            aria-label={`Reopen ${task.title}`}
          >
            Reopen
          </button>
        </>
      )}
    </li>
  )
}

const muted: CSSProperties = { margin: 0, fontSize: 13, opacity: 0.7 }

const badge: CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: 0.4,
  padding: '2px 6px',
  borderRadius: 4,
  border: '1px solid currentColor',
}

const btn: CSSProperties = {
  padding: '5px 10px',
  borderRadius: 6,
  border: '1px solid currentColor',
  background: 'transparent',
  color: 'inherit',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
}
