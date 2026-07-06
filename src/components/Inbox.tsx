import { useState } from 'react'
import { useTheme } from '../theme/ThemeProvider'
import { inboxChrome } from '../theme/chrome'
import { useIsMobile } from '../lib/useMediaQuery'
import { notesForDay } from '../data/selectors'
import { DropLane } from '../dnd/DropLane'
import { SortableCard } from '../dnd/SortableCard'
import { INBOX, type Task } from '../types/task'
import type { BoardHandlers, PopId } from './boardHandlers'

export interface InboxProps {
  tasks: Task[]
  handlers: BoardHandlers
  pop: PopId
}

export function Inbox({ tasks, handlers, pop }: InboxProps) {
  const { theme, conf } = useTheme()
  const isMobile = useIsMobile()
  const [collapsed, setCollapsed] = useState(false)
  const c = inboxChrome(theme, conf)
  const notes = notesForDay(tasks, INBOX)

  // Phones: the inbox docks full-width under the calendar (Board stacks the two) and its
  // header becomes a collapse toggle so the calendar can take the whole screen when wanted.
  const showBody = !isMobile || !collapsed

  return (
    <div
      style={{
        ...c.inbox,
        ...(isMobile && { width: '100%', flex: 'none', maxHeight: collapsed ? undefined : '34vh' }),
      }}
    >
      <div
        style={{ ...c.inboxHead, ...(isMobile && { cursor: 'pointer', paddingBottom: 10 }) }}
        onClick={isMobile ? () => setCollapsed((v) => !v) : undefined}
      >
        <span>
          Inbox
          {isMobile && (
            <span style={{ fontSize: 12, marginLeft: 8, opacity: 0.6 }}>
              {collapsed ? '▸' : '▾'}
            </span>
          )}
        </span>
        <span style={c.inboxCount}>{notes.length}</span>
      </div>
      {showBody && (
        <>
          {!isMobile && <div style={c.inboxHint}>Unscheduled · drag onto a day</div>}
          <DropLane id={INBOX} itemIds={notes.map((n) => n.id)} style={c.inboxList}>
            {notes.map((t) => (
              <SortableCard
                key={t.id}
                task={t}
                variant="inbox"
                pop={pop === t.id}
                onOpen={handlers.onOpen}
                onToggleDone={handlers.onToggleDone}
                onTogglePin={handlers.onTogglePin}
              />
            ))}
            {notes.length === 0 && (
              <div style={c.inboxEmpty}>
                Nothing here. Drag a note in to park it, or hit “+ New task”.
              </div>
            )}
          </DropLane>
          <button type="button" style={c.inboxAdd} onClick={handlers.onAddInbox}>
            + Add to inbox
          </button>
        </>
      )}
    </div>
  )
}
