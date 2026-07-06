import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { DndContext, DragOverlay } from '@dnd-kit/core'
import { useTheme } from '../theme/ThemeProvider'
import { DragDisabledContext } from '../dnd/dragContext'
import { rootStyle, blobStyles } from '../theme/chrome'
import { MONTHS_LONG, addDays, addMonths, formatWeekRange, startOfWeek } from '../lib/dates'
import { useIsMobile } from '../lib/useMediaQuery'
import { readBoardView, writeBoardView } from '../lib/viewStorage'
import { useBoardDnd } from '../dnd/useBoardDnd'
import { CardOverlay } from '../dnd/CardOverlay'
import type { Mode } from '../dnd/reorder'
import { newId } from '../lib/id'
import { Toolbar } from './Toolbar'
import { CalendarView } from './CalendarView'
import { WeekView } from './WeekView'
import { AgendaView } from './AgendaView'
import { Inbox } from './Inbox'
import { KanbanView } from './KanbanView'
import { TaskEditor, type RecurScope } from './TaskEditor'
import { SearchFilterBar } from './SearchFilterBar'
import { applyFilters, isFilterActive, EMPTY_FILTER, type FilterQuery } from '../data/filters'
import type { ViewOption } from './ViewSwitcher'
import type { BoardHandlers, PopId } from './boardHandlers'
import { NO_RECUR, type Status, type Task, type ViewName } from '../types/task'

interface Editing {
  task: Task
  isNew: boolean
}

export interface BoardProps {
  tasks: Task[]
  /** Optimistic local setter (drag-over live moves). */
  setTasks: Dispatch<SetStateAction<Task[]>>
  onCreate: (task: Task) => void
  onUpdate: (task: Task) => void
  onDelete: (id: string) => void
  onToggleDone: (id: string) => void
  persistReorder: (next: Task[], containers: string[], mode: Mode) => void
  getTemplate: (parentId: string) => Task | undefined
  updateSeries: (instance: Task, draft: Task) => void
  deleteOccurrence: (instance: Task) => void
  deleteSeriesFuture: (instance: Task) => void
  initialView?: ViewName
  onSignOut?: () => void
  onOpenSettings?: () => void
}

const VIEWS: ViewOption[] = [
  { key: 'calendar', label: 'Calendar' },
  { key: 'week', label: 'Week' },
  { key: 'agenda', label: 'Agenda' },
  { key: 'kanban', label: 'Board' },
]

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
    atTime: null,
    pinned: false,
    order: 9999,
    korder: 9999,
    ...NO_RECUR,
  }
}

export function Board({
  tasks,
  setTasks,
  onCreate,
  onUpdate,
  onDelete,
  onToggleDone,
  persistReorder,
  getTemplate,
  updateSeries,
  deleteOccurrence,
  deleteSeriesFuture,
  initialView,
  onSignOut,
  onOpenSettings,
}: BoardProps) {
  const { theme, conf } = useTheme()
  const isMobile = useIsMobile()
  const [view, setView] = useState<ViewName>(() => readBoardView() ?? initialView ?? 'calendar')
  const [anchor, setAnchor] = useState(() => new Date())
  const [pop, setPop] = useState<PopId>(null)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [filter, setFilter] = useState<FilterQuery>(EMPTY_FILTER)
  const popTimer = useRef<number | undefined>(undefined)

  const filterActive = isFilterActive(filter)
  const visibleTasks = useMemo(() => applyFilters(tasks, filter), [tasks, filter])

  const dnd = useBoardDnd(view, tasks, setTasks, persistReorder)

  useEffect(() => () => window.clearTimeout(popTimer.current), [])

  const changeView = (v: ViewName) => {
    setView(v)
    writeBoardView(v)
  }

  const handleToggle = (id: string) => {
    const t = tasks.find((x) => x.id === id)
    if (t && !t.done) {
      setPop(id)
      window.clearTimeout(popTimer.current)
      popTimer.current = window.setTimeout(() => setPop(null), 520)
    }
    onToggleDone(id)
  }

  const handleSave = (task: Task, scope?: RecurScope) => {
    const orig = editing?.task
    if (editing?.isNew) {
      onCreate(task) // createTask spawns a series if the task carries a rule
    } else if (orig?.recurParentId && scope === 'future') {
      updateSeries(orig, task)
    } else if (orig?.recurParentId) {
      // "this occurrence": update just this instance, never persisting a rule onto it
      onUpdate({
        ...task,
        recurFreq: 'none',
        recurInterval: 1,
        recurUntil: null,
        recurParentId: orig.recurParentId,
      })
    } else {
      onUpdate(task) // non-recurring (updateTask converts it to a series if a rule was added)
    }
    setEditing(null)
  }

  const handleDelete = (task: Task, scope?: RecurScope) => {
    if (task.recurParentId && scope === 'future') deleteSeriesFuture(task)
    else if (task.recurParentId && scope === 'this') deleteOccurrence(task)
    else onDelete(task.id)
    setEditing(null)
  }

  const openTask = (task: Task) => {
    let t = task
    if (task.recurParentId) {
      const tmpl = getTemplate(task.recurParentId)
      if (tmpl)
        t = {
          ...task,
          recurFreq: tmpl.recurFreq,
          recurInterval: tmpl.recurInterval,
          recurUntil: tmpl.recurUntil,
        }
    }
    setEditing({ task: t, isNew: false })
  }

  const handlers: BoardHandlers = {
    onOpen: openTask,
    onToggleDone: handleToggle,
    onAddDay: (dateStr) => setEditing({ task: newTaskTemplate(dateStr, 'todo'), isNew: true }),
    onAddInbox: () => setEditing({ task: newTaskTemplate('inbox', 'todo'), isNew: true }),
    onAddStatus: (status) => setEditing({ task: newTaskTemplate('inbox', status), isNew: true }),
  }

  const year = anchor.getFullYear()
  const month = anchor.getMonth()
  const weekStart = startOfWeek(anchor)
  const showNav = view === 'calendar' || view === 'week'
  const navLabel = view === 'week' ? formatWeekRange(weekStart) : `${MONTHS_LONG[month]} ${year}`

  const onPrev = () => setAnchor((a) => (view === 'week' ? addDays(a, -7) : addMonths(a, -1)))
  const onNext = () => setAnchor((a) => (view === 'week' ? addDays(a, 7) : addMonths(a, 1)))
  const onToday = () => setAnchor(new Date())

  return (
    <div className="app-root" style={rootStyle(conf)}>
      {theme === 'glass' && blobStyles().map((b, i) => <div key={i} style={b} />)}

      <Toolbar
        views={VIEWS}
        view={view}
        onChangeView={changeView}
        showNav={showNav}
        navLabel={navLabel}
        onPrev={onPrev}
        onNext={onNext}
        onToday={onToday}
        onAddInbox={handlers.onAddInbox}
        onSignOut={onSignOut}
        onOpenSettings={onOpenSettings}
      />

      <SearchFilterBar query={filter} onChange={setFilter} />

      <DndContext
        sensors={dnd.sensors}
        collisionDetection={dnd.collisionDetection}
        onDragStart={dnd.onDragStart}
        onDragOver={dnd.onDragOver}
        onDragEnd={dnd.onDragEnd}
        onDragCancel={dnd.onDragCancel}
      >
        <DragDisabledContext.Provider value={filterActive}>
          <div
            style={{
              display: 'flex',
              gap: isMobile ? 10 : 18,
              flex: 1,
              minHeight: 0,
              padding: isMobile ? '10px 10px 12px' : '18px 22px 22px',
              position: 'relative',
              zIndex: 1,
            }}
          >
            {view === 'kanban' ? (
              <KanbanView tasks={visibleTasks} handlers={handlers} pop={pop} />
            ) : view === 'agenda' ? (
              <AgendaView tasks={visibleTasks} handlers={handlers} pop={pop} />
            ) : (
              <div
                style={{
                  display: 'flex',
                  flexDirection: isMobile ? 'column' : 'row',
                  gap: isMobile ? 10 : 18,
                  flex: 1,
                  minHeight: 0,
                  width: '100%',
                }}
              >
                {view === 'week' ? (
                  <WeekView
                    weekStart={weekStart}
                    tasks={visibleTasks}
                    handlers={handlers}
                    pop={pop}
                  />
                ) : (
                  <CalendarView
                    viewY={year}
                    viewM={month}
                    tasks={visibleTasks}
                    handlers={handlers}
                    pop={pop}
                  />
                )}
                <Inbox tasks={visibleTasks} handlers={handlers} pop={pop} />
              </div>
            )}
          </div>
        </DragDisabledContext.Provider>

        <DragOverlay>
          {dnd.activeTask ? <CardOverlay task={dnd.activeTask} width={dnd.activeWidth} /> : null}
        </DragOverlay>
      </DndContext>

      {editing && (
        <TaskEditor
          key={editing.task.id}
          initial={editing.task}
          isNew={editing.isNew}
          onSave={handleSave}
          onDelete={handleDelete}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}
