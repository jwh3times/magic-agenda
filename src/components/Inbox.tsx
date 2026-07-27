import { useState } from 'react'
import { Link } from 'react-router'
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
          {/* ROADMAP 5.3 — the legal pages reachable from the board itself, not only from /settings
              and the login screen. The roadmap suggested "the mobile toolbar overflow", but no
              overflow menu exists and the phone toolbar is already three stacked rows; the inbox
              foot is the one always-rendered surface (it sits outside the view switch in Board)
              that costs neither board nor toolbar space. */}
          <div
            style={{
              margin: '0 16px 14px',
              display: 'flex',
              gap: 12,
              fontSize: 11,
              opacity: 0.55,
              color: conf.numFg,
            }}
          >
            <Link to="/privacy" style={{ color: 'inherit' }}>
              Privacy
            </Link>
            <Link to="/terms" style={{ color: 'inherit' }}>
              Terms
            </Link>
          </div>
        </>
      )}
    </div>
  )
}
