import { useContext, useEffect, useMemo, useRef, useState, type ComponentProps } from 'react'
import { DndContext, DragOverlay } from '@dnd-kit/core'
import { useTheme } from '../theme/ThemeProvider'
import { DragDisabledContext } from '../dnd/dragContext'
import { OfflineContext } from '../data/offlineContext'
import { OfflineBanner } from './OfflineBanner'
import { rootStyle, blobStyles } from '../theme/chrome'
import {
  MONTHS_LONG,
  addDays,
  addMonths,
  formatWeekRange,
  parseDay,
  startOfWeek,
} from '../lib/dates'
import { useToday } from '../data/todayContext'
import { useIsMobile } from '../lib/useMediaQuery'
import { readBoardView, writeBoardView } from '../lib/viewStorage'
import { useBoardDnd } from '../dnd/useBoardDnd'
import { CardOverlay } from '../dnd/CardOverlay'
import { newId } from '../lib/id'
import { Toolbar } from './Toolbar'
import { CalendarView } from './CalendarView'
import { WeekView } from './WeekView'
import { AgendaView } from './AgendaView'
import { Inbox } from './Inbox'
import { KanbanView } from './KanbanView'
import { TaskEditor } from './TaskEditor'
import { SearchFilterBar } from './SearchFilterBar'
import { applyFilters, isFilterActive, EMPTY_FILTER, type FilterQuery } from '../data/filters'
import { overdueTasks } from '../data/selectors'
import type { ViewOption } from './ViewSwitcher'
import { BoardActionContext, type BoardActions } from './boardActionContext'
import { useTaskBoard } from '../data/taskBoardContext'
import { NO_RECUR, type Status, type Task, type TaskDraft, type ViewName } from '../types/task'

interface Editing {
  /** The editor's working shape: an Occurrence here also carries its Series' Rule. */
  task: TaskDraft
  isNew: boolean
}

export interface BoardProps {
  initialView?: ViewName
  /** 0=Sunday … 6=Saturday. Passed rather than contexted: it only travels two levels. */
  weekStart?: number
  onSignOut?: () => void
  onOpenSettings?: () => void
  /** Whether this Board membership may assign Labels to Tasks. */
  canAssignLabels?: boolean
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
    labelId: null,
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
  initialView,
  weekStart = 0,
  onSignOut,
  onOpenSettings,
  canAssignLabels = true,
}: BoardProps) {
  const taskBoard = useTaskBoard()
  const { tasks } = taskBoard
  const { theme, conf } = useTheme()
  const isMobile = useIsMobile()
  const { readOnly, fallbackReason, savedAt, timezone } = useContext(OfflineContext)
  // A choice made in this tab wins over the account default; a new tab starts at initialView.
  const [view, setView] = useState<ViewName>(() => readBoardView() ?? initialView ?? 'calendar')
  const today = useToday()
  const [anchor, setAnchor] = useState(() => parseDay(today))
  const [popId, setPopId] = useState<string | null>(null)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [filter, setFilter] = useState<FilterQuery>(EMPTY_FILTER)
  const popTimer = useRef<number | undefined>(undefined)

  const filterActive = isFilterActive(filter)
  const visibleTasks = useMemo(() => applyFilters(tasks, filter), [tasks, filter])
  const visibleOverdue = useMemo(() => overdueTasks(visibleTasks, today), [visibleTasks, today])
  const overdueCount = visibleOverdue.length

  const dnd = useBoardDnd(view, tasks, taskBoard.previewReorder, taskBoard.persistReorder)

  useEffect(() => () => window.clearTimeout(popTimer.current), [])

  const changeView = (v: ViewName) => {
    setView(v)
    writeBoardView(v)
  }

  const handleToggle = (id: string) => {
    const t = tasks.find((x) => x.id === id)
    if (t && !t.done) {
      setPopId(id)
      window.clearTimeout(popTimer.current)
      popTimer.current = window.setTimeout(() => setPopId(null), 520)
    }
    void taskBoard.toggleDone(id)
  }

  const handlePin = (id: string) => {
    const t = tasks.find((x) => x.id === id)
    if (t) void taskBoard.updateTask({ ...t, pinned: !t.pinned })
  }

  // The four-way save dispatch and the three-way delete dispatch used to live here, which meant
  // this shell had to know that a set `recurParentId` means "this is an instance" — and had to
  // remember to strip the rule fields on the this-occurrence path. Both now resolve in
  // src/data/series.ts, where the rest of that invariant lives.
  const handleSave: NonNullable<ComponentProps<typeof TaskEditor>['onSave']> = (task, scope) => {
    void taskBoard.saveTask(editing?.task ?? null, task, Boolean(editing?.isNew), scope)
    setEditing(null)
  }

  const handleDelete: NonNullable<ComponentProps<typeof TaskEditor>['onDelete']> = (id, scope) => {
    void taskBoard.deleteTask(id, scope)
    setEditing(null)
  }

  const openTask = (task: Task) => {
    let t: TaskDraft = task
    if (task.recurParentId) {
      const tmpl = taskBoard.getTemplate(task.recurParentId)
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

  const actions: BoardActions = {
    popId,
    onOpen: openTask,
    // Undefined (not a no-op) while read-only: TaskCard already falls back to a non-interactive
    // <span> when no handler is passed, so this is the existing affordance, not a new one.
    onToggleDone: readOnly ? undefined : handleToggle,
    onTogglePin: readOnly ? undefined : handlePin,
    onAddDay: (dateStr) => setEditing({ task: newTaskTemplate(dateStr, 'todo'), isNew: true }),
    onAddInbox: () => setEditing({ task: newTaskTemplate('inbox', 'todo'), isNew: true }),
    onAddStatus: (status) => setEditing({ task: newTaskTemplate('inbox', status), isNew: true }),
    onRollForward:
      visibleOverdue.length > 0
        ? () => void taskBoard.rollForward(today, new Set(visibleOverdue.map((task) => task.id)))
        : undefined,
  }

  const year = anchor.getFullYear()
  const month = anchor.getMonth()
  const weekStartDate = startOfWeek(anchor, weekStart)
  const showNav = view === 'calendar' || view === 'week'
  const navLabel =
    view === 'week' ? formatWeekRange(weekStartDate) : `${MONTHS_LONG[month]} ${year}`

  const onPrev = () => setAnchor((a) => (view === 'week' ? addDays(a, -7) : addMonths(a, -1)))
  const onNext = () => setAnchor((a) => (view === 'week' ? addDays(a, 7) : addMonths(a, 1)))
  const onToday = () => setAnchor(parseDay(today))

  return (
    <BoardActionContext.Provider value={actions}>
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
          onAddInbox={actions.onAddInbox}
          onSignOut={onSignOut}
          onOpenSettings={onOpenSettings}
          overdueCount={overdueCount}
          addDisabled={readOnly}
        />

        {readOnly && (
          <OfflineBanner
            reason={fallbackReason ?? 'request-error'}
            savedAt={savedAt}
            timezone={timezone}
          />
        )}

        <SearchFilterBar query={filter} onChange={setFilter} />

        <DndContext
          sensors={dnd.sensors}
          collisionDetection={dnd.collisionDetection}
          onDragStart={dnd.onDragStart}
          onDragOver={dnd.onDragOver}
          onDragEnd={dnd.onDragEnd}
          onDragCancel={dnd.onDragCancel}
        >
          <DragDisabledContext.Provider value={filterActive || readOnly}>
            <main
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
                <KanbanView tasks={visibleTasks} />
              ) : view === 'agenda' ? (
                <AgendaView tasks={visibleTasks} />
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
                    <WeekView weekStart={weekStartDate} tasks={visibleTasks} />
                  ) : (
                    <CalendarView
                      viewY={year}
                      viewM={month}
                      weekStart={weekStart}
                      tasks={visibleTasks}
                    />
                  )}
                  <Inbox tasks={visibleTasks} />
                </div>
              )}
            </main>
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
            readOnly={readOnly}
            canAssignLabels={canAssignLabels}
          />
        )}
      </div>
    </BoardActionContext.Provider>
  )
}
