import { useTheme } from '../theme/ThemeProvider'
import { inboxChrome } from '../theme/chrome'
import { notesForDay } from '../data/selectors'
import { TaskCard } from './TaskCard'
import { INBOX, type Task } from '../types/task'
import type { BoardHandlers, PopId } from './boardHandlers'

export interface InboxProps {
  tasks: Task[]
  handlers: BoardHandlers
  pop: PopId
}

export function Inbox({ tasks, handlers, pop }: InboxProps) {
  const { theme, conf } = useTheme()
  const c = inboxChrome(theme, conf)
  const notes = notesForDay(tasks, INBOX)

  return (
    <div style={c.inbox}>
      <div style={c.inboxHead}>
        <span>Inbox</span>
        <span style={c.inboxCount}>{notes.length}</span>
      </div>
      <div style={c.inboxHint}>Unscheduled · drag onto a day</div>
      <div style={c.inboxList}>
        {notes.map((t) => (
          <TaskCard
            key={t.id}
            task={t}
            variant="inbox"
            pop={pop === t.id}
            onOpen={handlers.onOpen}
            onToggleDone={handlers.onToggleDone}
          />
        ))}
        {notes.length === 0 && (
          <div style={c.inboxEmpty}>
            Nothing here. Drag a note in to park it, or hit “+ New task”.
          </div>
        )}
      </div>
      <button type="button" style={c.inboxAdd} onClick={handlers.onAddInbox}>
        + Add to inbox
      </button>
    </div>
  )
}
