import { useEffect, useRef, useState } from 'react'
import { useTheme } from '../theme/ThemeProvider'
import { rootStyle, blobStyles } from '../theme/chrome'
import { MONTHS_LONG } from '../lib/dates'
import { applyToggleDone } from '../data/selectors'
import { makeMockTasks } from '../data/mockTasks'
import { Toolbar } from './Toolbar'
import { CalendarView } from './CalendarView'
import { Inbox } from './Inbox'
import { KanbanView } from './KanbanView'
import type { ViewOption } from './ViewSwitcher'
import type { BoardHandlers, PopId } from './boardHandlers'
import type { ViewName } from '../types/task'

const VIEWS: ViewOption[] = [
  { key: 'calendar', label: 'Calendar' },
  { key: 'kanban', label: 'Board' },
]

export function Board() {
  const { theme, conf } = useTheme()
  const [tasks, setTasks] = useState(makeMockTasks)
  const [view, setView] = useState<ViewName>('calendar')
  const now = new Date()
  const [viewY, setViewY] = useState(now.getFullYear())
  const [viewM, setViewM] = useState(now.getMonth())
  const [pop, setPop] = useState<PopId>(null)
  const popTimer = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(popTimer.current), [])

  const toggleDone = (id: string) => {
    setTasks((prev) => {
      const { tasks: next, justDone } = applyToggleDone(prev, id)
      if (justDone) {
        setPop(id)
        window.clearTimeout(popTimer.current)
        popTimer.current = window.setTimeout(() => setPop(null), 520)
      }
      return next
    })
  }

  // Editor opens are wired in Phase 5; the add buttons + card clicks are inert for now.
  const handlers: BoardHandlers = {
    onOpen: () => {},
    onToggleDone: toggleDone,
    onAddDay: () => {},
    onAddInbox: () => {},
    onAddStatus: () => {},
  }

  const isCalendar = view === 'calendar'
  const onPrev = () =>
    setViewM((m) => {
      if (m === 0) {
        setViewY((y) => y - 1)
        return 11
      }
      return m - 1
    })
  const onNext = () =>
    setViewM((m) => {
      if (m === 11) {
        setViewY((y) => y + 1)
        return 0
      }
      return m + 1
    })
  const onToday = () => {
    const d = new Date()
    setViewM(d.getMonth())
    setViewY(d.getFullYear())
  }

  return (
    <div style={rootStyle(conf)}>
      {theme === 'glass' &&
        blobStyles().map((b, i) => <div key={i} style={b} />)}

      <Toolbar
        views={VIEWS}
        view={view}
        onChangeView={setView}
        isCalendar={isCalendar}
        monthName={MONTHS_LONG[viewM]}
        year={viewY}
        onPrev={onPrev}
        onNext={onNext}
        onToday={onToday}
        onAddInbox={handlers.onAddInbox}
      />

      <div
        style={{
          display: 'flex',
          gap: 18,
          flex: 1,
          minHeight: 0,
          padding: '18px 22px 22px',
          position: 'relative',
          zIndex: 1,
        }}
      >
        {view === 'kanban' ? (
          <KanbanView tasks={tasks} handlers={handlers} pop={pop} />
        ) : (
          <div style={{ display: 'flex', gap: 18, flex: 1, minHeight: 0, width: '100%' }}>
            <CalendarView viewY={viewY} viewM={viewM} tasks={tasks} handlers={handlers} pop={pop} />
            <Inbox tasks={tasks} handlers={handlers} pop={pop} />
          </div>
        )}
      </div>
    </div>
  )
}
