import type { CSSProperties } from 'react'
import { useTheme } from '../theme/ThemeProvider'
import { agendaGroups, notesForDay, overdueTasks } from '../data/selectors'
import { formatAgendaDate, ymd } from '../lib/dates'
import { TaskCard } from './TaskCard'
import { INBOX, type Task } from '../types/task'
import type { BoardHandlers, PopId } from './boardHandlers'

export interface AgendaViewProps {
  tasks: Task[]
  handlers: BoardHandlers
  pop: PopId
  onRollForward?: () => void
}

/** Flat chronological list grouped by date (+ an Unscheduled group). Cards are click-to-edit. */
export function AgendaView({ tasks, handlers, pop, onRollForward }: AgendaViewProps) {
  const { conf } = useTheme()
  const today = ymd(new Date())
  const overdue = overdueTasks(tasks, today)
  const overdueIds = new Set(overdue.map((t) => t.id))
  const groups = agendaGroups(tasks.filter((t) => !overdueIds.has(t.id)))
  const inbox = notesForDay(tasks, INBOX)

  const header: CSSProperties = {
    fontFamily: conf.ui,
    fontSize: 13,
    fontWeight: 800,
    letterSpacing: '.5px',
    textTransform: 'uppercase',
    color: conf.numFg,
    paddingBottom: 8,
    borderBottom: `2px solid ${conf.accent}`,
  }
  const list: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }

  const empty = groups.length === 0 && inbox.length === 0 && overdue.length === 0

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: 'auto', width: '100%' }}>
      <div
        style={{
          maxWidth: 720,
          margin: '0 auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 24,
          padding: '4px 4px 36px',
        }}
      >
        {empty && (
          <div
            style={{
              textAlign: 'center',
              color: conf.numFg,
              opacity: 0.6,
              padding: '60px 0',
              fontFamily: conf.ui,
            }}
          >
            Nothing scheduled. Add a task or drag one onto a day.
          </div>
        )}

        {overdue.length > 0 && (
          <div>
            <div
              style={{
                ...header,
                borderBottom: '2px solid #e0524a',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <span>Overdue</span>
              {onRollForward && (
                <button
                  type="button"
                  onClick={onRollForward}
                  style={{
                    border: 'none',
                    borderRadius: 7,
                    padding: '4px 10px',
                    cursor: 'pointer',
                    fontFamily: conf.ui,
                    fontSize: 11.5,
                    fontWeight: 800,
                    background: '#e0524a',
                    color: '#fff',
                  }}
                >
                  Move all to today
                </button>
              )}
            </div>
            <div style={list}>
              {overdue.map((t) => (
                <TaskCard
                  key={t.id}
                  task={t}
                  variant="inbox"
                  pop={pop === t.id}
                  onOpen={handlers.onOpen}
                  onToggleDone={handlers.onToggleDone}
                  onTogglePin={handlers.onTogglePin}
                />
              ))}
            </div>
          </div>
        )}

        {groups.map((g) => (
          <div key={g.day}>
            <div style={header}>{formatAgendaDate(g.day)}</div>
            <div style={list}>
              {g.tasks.map((t) => (
                <TaskCard
                  key={t.id}
                  task={t}
                  variant="inbox"
                  pop={pop === t.id}
                  onOpen={handlers.onOpen}
                  onToggleDone={handlers.onToggleDone}
                  onTogglePin={handlers.onTogglePin}
                />
              ))}
            </div>
          </div>
        ))}

        {inbox.length > 0 && (
          <div>
            <div style={header}>Unscheduled · Inbox</div>
            <div style={list}>
              {inbox.map((t) => (
                <TaskCard
                  key={t.id}
                  task={t}
                  variant="inbox"
                  pop={pop === t.id}
                  onOpen={handlers.onOpen}
                  onToggleDone={handlers.onToggleDone}
                  onTogglePin={handlers.onTogglePin}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
