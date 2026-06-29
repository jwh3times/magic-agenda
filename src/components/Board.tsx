import { useEffect, useRef, useState } from 'react'
import { DndContext, DragOverlay } from '@dnd-kit/core'
import { useTheme } from '../theme/ThemeProvider'
import { rootStyle, blobStyles } from '../theme/chrome'
import { MONTHS_LONG } from '../lib/dates'
import { applyToggleDone } from '../data/selectors'
import { makeMockTasks } from '../data/mockTasks'
import { useBoardDnd } from '../dnd/useBoardDnd'
import { CardOverlay } from '../dnd/CardOverlay'
import { newId } from '../lib/id'
import { Toolbar } from './Toolbar'
import { CalendarView } from './CalendarView'
import { Inbox } from './Inbox'
import { KanbanView } from './KanbanView'
import { TaskEditor } from './TaskEditor'
import type { ViewOption } from './ViewSwitcher'
import type { BoardHandlers, PopId } from './boardHandlers'
import type { Status, Task, ViewName } from '../types/task'

interface Editing {
  task: Task
  isNew: boolean
}

function newTaskTemplate(day: string, status: Status): Task {
  return {
    id: newId(),
    title: '',
    description: '',
    category: 'work',
    color: 'yellow',
    checklist: [],
    status,
    done: status === 'done',
    day,
    order: 9999,
    korder: 9999,
  }
}

const VIEWS: ViewOption[] = [
  { key: 'calendar', label: 'Calendar' },
  { key: 'kanban', label: 'Board' },
]

export function Board({ onSignOut }: { onSignOut?: () => void }) {
  const { theme, conf } = useTheme()
  const [tasks, setTasks] = useState(makeMockTasks)
  const [view, setView] = useState<ViewName>('calendar')
  const now = new Date()
  const [viewY, setViewY] = useState(now.getFullYear())
  const [viewM, setViewM] = useState(now.getMonth())
  const [pop, setPop] = useState<PopId>(null)
  const [editing, setEditing] = useState<Editing | null>(null)
  const popTimer = useRef<number | undefined>(undefined)

  const dnd = useBoardDnd(view, tasks, setTasks)

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

  const saveTask = (task: Task) => {
    setTasks((prev) => {
      const exists = prev.some((t) => t.id === task.id)
      if (exists) return prev.map((t) => (t.id === task.id ? task : t))
      const order = prev.filter((t) => t.day === task.day).reduce((m, t) => Math.max(m, t.order), -1) + 1
      const korder =
        prev.filter((t) => t.status === task.status).reduce((m, t) => Math.max(m, t.korder), -1) + 1
      return [...prev, { ...task, order, korder }]
    })
    setEditing(null)
  }

  const deleteTask = (id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id))
    setEditing(null)
  }

  const handlers: BoardHandlers = {
    onOpen: (task) => setEditing({ task, isNew: false }),
    onToggleDone: toggleDone,
    onAddDay: (dateStr) => setEditing({ task: newTaskTemplate(dateStr, 'todo'), isNew: true }),
    onAddInbox: () => setEditing({ task: newTaskTemplate('inbox', 'todo'), isNew: true }),
    onAddStatus: (status) => setEditing({ task: newTaskTemplate('inbox', status), isNew: true }),
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
        onSignOut={onSignOut}
      />

      <DndContext
        sensors={dnd.sensors}
        collisionDetection={dnd.collisionDetection}
        onDragStart={dnd.onDragStart}
        onDragOver={dnd.onDragOver}
        onDragEnd={dnd.onDragEnd}
        onDragCancel={dnd.onDragCancel}
      >
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

        <DragOverlay>
          {dnd.activeTask ? <CardOverlay task={dnd.activeTask} width={dnd.activeWidth} /> : null}
        </DragOverlay>
      </DndContext>

      {editing && (
        <TaskEditor
          key={editing.task.id}
          initial={editing.task}
          isNew={editing.isNew}
          onSave={saveTask}
          onDelete={deleteTask}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}
