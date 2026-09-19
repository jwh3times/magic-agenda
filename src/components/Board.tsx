import { useContext, useEffect, useMemo, useRef, useState, type ComponentProps } from 'react'
import { DndContext, DragOverlay, type ScreenReaderInstructions } from '@dnd-kit/core'
import { useTheme } from '../theme/ThemeProvider'
import { DragDisabledContext } from '../dnd/dragContext'
import { OfflineContext } from '../data/offlineContext'
import { OfflineBanner } from './OfflineBanner'
import { rootStyle, blobStyles } from '../theme/chrome'
import {
  MONTHS_LONG,
  addDays,
  addMonths,
  formatAgendaDate,
  formatWeekRange,
  parseDay,
  startOfWeek,
} from '../lib/dates'
import { useToday } from '../data/todayContext'
import { useDueClock } from '../data/dueClockContext'
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
import { CommandPalette, type PaletteCommand } from './CommandPalette'
import { ShortcutHelp } from './ShortcutHelp'
import { Toast } from './Toast'
import { BulkActionBar } from './BulkActionBar'
import { planBulkUpdate, type BulkChange } from '../data/bulk'
import { useKeyboardShortcuts } from '../lib/useKeyboardShortcuts'
import type { ShortcutAction } from '../lib/keyboardShortcuts'
import { dateOrderForLocale, parseQuickAdd } from '../data/quickAdd'
import { taskLimitError } from '../data/taskLimits'
import { applyFilters, isFilterActive, EMPTY_FILTER, type FilterQuery } from '../data/filters'
import { isArchived } from '../data/completion'
import { overdueTasks } from '../data/selectors'
import type { ViewOption } from './ViewSwitcher'
import { BoardActionContext, type BoardActions, type OpenOptions } from './boardActionContext'
import { useTaskBoard } from '../data/taskBoardContext'
import {
  INBOX,
  NO_RECUR,
  type Task,
  type TaskDraft,
  type ThemeName,
  type ViewName,
  type WorkflowStatus,
} from '../types/task'
import { completionDecision } from '../data/completion'

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
  /** The account's single-letter keyboard shortcuts preference (#269). Ctrl/Cmd+K ignores it. */
  keyboardShortcuts?: boolean
  /** Forwarded to the editor so a Task's attachments can be addressed. See `TaskEditorProps`. */
  boardId?: string | null
}

/**
 * Replaces dnd-kit's default instructions, which describe only the drag half.
 *
 * Since #281 a card answers two keys — Space picks it up, Enter opens it — and the default text
 * says nothing about the second. A screen-reader user told only about dragging has no way to
 * discover that the editor is reachable at all, which is the same functional gap the key split
 * fixes, just spoken instead of typed. Keep these in step with `KEYBOARD_CODES` in
 * `useBoardDnd.ts`: the sensor and the sentence describing it are one decision in two places.
 */
const DND_INSTRUCTIONS: ScreenReaderInstructions = {
  draggable: `
    To open a task, press Enter.
    To pick a task up and move it, press the space bar, then use the arrow keys.
    Press space again to drop it in its new position, or press escape to cancel.
  `,
}

/**
 * Said after every undo, because undo is last-write-wins (#271): it restores this device's earlier
 * version of the affected tasks, over anything another device changed on them in the meantime.
 */
export const UNDONE_NOTICE =
  'Undone. Your earlier version is back, replacing any change made to those tasks on another device since.'

const VIEWS: ViewOption[] = [
  { key: 'calendar', label: 'Calendar' },
  { key: 'week', label: 'Week' },
  { key: 'agenda', label: 'Agenda' },
  { key: 'kanban', label: 'Board' },
]

/**
 * Theme names as the command palette offers them. They must read exactly as ThemeSwitcher's
 * labels do, which keeps its list private to that component; keep the two in step.
 */
const THEME_OPTIONS: { key: ThemeName; label: string }[] = [
  { key: 'cork', label: 'Cork' },
  { key: 'brutal', label: 'Neon' },
  { key: 'glass', label: 'Aurora' },
]

function newTaskTemplate(day: string, status: WorkflowStatus): Task {
  const active = {
    id: newId(),
    title: '',
    description: '',
    labelId: null,
    color: 'yellow',
    checklist: [],
    status: 'todo' as const,
    completedAt: null,
    reopenStatus: 'todo' as const,
    archivedAt: null,
    day,
    atTime: null,
    pinned: false,
    order: 9999,
    korder: 9999,
    ...NO_RECUR,
  } satisfies Task
  return {
    ...active,
    ...completionDecision(active, status, new Date().toISOString()),
  }
}

export function Board({
  initialView,
  weekStart = 0,
  onSignOut,
  onOpenSettings,
  canAssignLabels = true,
  keyboardShortcuts = true,
  boardId = null,
}: BoardProps) {
  const taskBoard = useTaskBoard()
  const { tasks } = taskBoard
  const { theme, conf, setTheme } = useTheme()
  const isMobile = useIsMobile()
  const { readOnly, fallbackReason, savedAt, timezone } = useContext(OfflineContext)
  // A choice made in this tab wins over the account default; a new tab starts at initialView.
  const [view, setView] = useState<ViewName>(() => readBoardView() ?? initialView ?? 'calendar')
  const today = useToday()
  const { nowMs, timezone: dueTimezone } = useDueClock()
  const [anchor, setAnchor] = useState(() => parseDay(today))
  const [popId, setPopId] = useState<string | null>(null)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [filter, setFilter] = useState<FilterQuery>(EMPTY_FILTER)
  const popTimer = useRef<number | undefined>(undefined)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  // Selection mode (#270). Ids are kept as chosen; `selection` below narrows them to what is shown.
  const [selecting, setSelecting] = useState(false)
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set())
  // The action bar's measured height: the board reserves that much room below its lanes, and the
  // toast rises above it, so neither the last cards nor the bar's own buttons are covered.
  const [barHeight, setBarHeight] = useState(0)
  // Numeric quick-add dates ("3/4") follow the browser's locale, by the maintainer's decision.
  const dateOrder = useMemo(() => dateOrderForLocale(), [])

  const filterActive = isFilterActive(filter)
  // Archive is durable Board state (ADR-0003), so it is excluded here, ahead of every view's own
  // day/status bucketing and ahead of search — never through `filter`, which the user can clear.
  //
  // Only the *views* see this narrowed list. `useBoardDnd` below still gets the whole board, and
  // that is load-bearing twice over: `previewReorder` replaces state with whatever the drag
  // produces, so a narrowed input would silently drop every Archived row from `useTasks` (and from
  // the offline snapshot it writes); and the recurrence planners need Archived Occurrences present
  // to know an Occurrence Date is still occupied. An Archived card is never rendered, so it can
  // never be a drop target, and the lane arithmetic places visible cards correctly around it.
  const activeTasks = useMemo(() => tasks.filter((task) => !isArchived(task)), [tasks])
  const visibleTasks = useMemo(() => applyFilters(activeTasks, filter), [activeTasks, filter])
  const visibleOverdue = useMemo(
    () => overdueTasks(visibleTasks, nowMs, dueTimezone),
    [visibleTasks, nowMs, dueTimezone],
  )
  const rollForwardIds = useMemo(
    () => new Set(visibleOverdue.filter((task) => task.day < today).map((task) => task.id)),
    [visibleOverdue, today],
  )
  const overdueCount = visibleOverdue.length

  // Only cards the user can see count as selected: a filter change or a remote delete must never
  // leave a hidden Task inside the next bulk action. Offline, selection mode is off altogether.
  const selectionActive = selecting && !readOnly
  const selection = useMemo<ReadonlySet<string>>(
    () =>
      selectionActive
        ? new Set(visibleTasks.filter((t) => selectedIds.has(t.id)).map((t) => t.id))
        : new Set(),
    [selectionActive, visibleTasks, selectedIds],
  )
  const exitSelection = () => {
    setSelecting(false)
    setSelectedIds(new Set())
  }
  const toggleSelected = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const dnd = useBoardDnd(view, tasks, taskBoard.previewReorder, taskBoard.persistReorder)

  useEffect(() => () => window.clearTimeout(popTimer.current), [])

  const changeView = (v: ViewName) => {
    setView(v)
    writeBoardView(v)
  }

  const handleToggle = (id: string) => {
    const t = tasks.find((x) => x.id === id)
    if (t && t.status !== 'completed') {
      setPopId(id)
      window.clearTimeout(popTimer.current)
      popTimer.current = window.setTimeout(() => setPopId(null), 520)
    }
    void taskBoard.toggleCompletion(id)
  }

  const handlePin = (id: string) => {
    const t = tasks.find((x) => x.id === id)
    if (t) void taskBoard.updateTask({ ...t, pinned: !t.pinned })
  }

  // The four-way save dispatch and the three-way delete dispatch used to live here, which meant
  // this shell had to know that a set `recurParentId` means "this is an instance" — and had to
  // remember to strip the rule fields on the this-occurrence path. Both now resolve in
  // src/data/series.ts, where the rest of that invariant lives.
  const handleSave: NonNullable<ComponentProps<typeof TaskEditor>['onSave']> = (
    task,
    scope,
    modifiers,
  ) => {
    void taskBoard.saveTask(editing?.task ?? null, task, Boolean(editing?.isNew), scope, modifiers)
    setEditing(null)
  }

  const handleDelete: NonNullable<ComponentProps<typeof TaskEditor>['onDelete']> = (id, scope) => {
    void taskBoard.deleteTask(id, scope)
    setEditing(null)
  }

  const openTask = (task: Task, options?: OpenOptions) => {
    if (!readOnly && (selecting || options?.additive)) {
      setSelecting(true)
      toggleSelected(task.id)
      return
    }
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

  const toastBottom = selectionActive ? barHeight + (isMobile ? 12 : 20 + 12) : 20
  // A successful bulk action is announced by its undo toast (#271), whose label counts only the
  // Tasks it altered. A change that would alter nothing says so instead of writing, and a refused
  // or rolled-back write announces nothing and keeps the selection; its error surfaces on its own.
  const applyBulk = (change: BulkChange) => {
    if (selection.size === 0) return
    const altered = planBulkUpdate(tasks, selection, change, new Date().toISOString()).changed
    if (altered.length === 0) {
      // The undo toast outranks a notice, so step it aside or this feedback would wait behind it.
      taskBoard.dismissUndo()
      setNotice('The selected tasks already have that.')
      return
    }
    void taskBoard.bulkUpdate(selection, change)
  }
  const deleteSelection = () => {
    if (selection.size === 0) return
    void Promise.resolve(taskBoard.bulkDelete(selection)).then((ok) => {
      if (ok) exitSelection()
    })
  }
  const undoLast = () => {
    void Promise.resolve(taskBoard.undo()).then((ok) => {
      if (ok) setNotice(UNDONE_NOTICE)
    })
  }

  const actions: BoardActions = {
    popId,
    onOpen: openTask,
    selectedIds: selectionActive ? selection : undefined,
    // Undefined (not a no-op) while read-only: TaskCard already falls back to a non-interactive
    // <span> when no handler is passed, so this is the existing affordance, not a new one.
    onToggleCompletion: readOnly ? undefined : handleToggle,
    onTogglePin: readOnly ? undefined : handlePin,
    onAddDay: (dateStr) => setEditing({ task: newTaskTemplate(dateStr, 'todo'), isNew: true }),
    onAddInbox: () => setEditing({ task: newTaskTemplate('inbox', 'todo'), isNew: true }),
    onAddStatus: (status) => setEditing({ task: newTaskTemplate('inbox', status), isNew: true }),
    onRollForward:
      rollForwardIds.size > 0 ? () => void taskBoard.rollForward(today, rollForwardIds) : undefined,
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

  const whenLabel = (day: string) => (day === INBOX ? 'Inbox' : formatAgendaDate(day))

  // Quick-add creates the task straight away (the maintainer's decision), so it is refused wherever
  // + New task is: on a read-only board, and for a title the editor itself would reject.
  const quickAddPreview = (text: string) => {
    if (readOnly) return null
    const parsed = parseQuickAdd(text, today, dateOrder)
    return parsed.title ? { title: parsed.title, when: whenLabel(parsed.day) } : null
  }
  const quickAdd = (text: string) => {
    if (readOnly) return
    const parsed = parseQuickAdd(text, today, dateOrder)
    if (!parsed.title) return
    const task: Task = { ...newTaskTemplate(parsed.day, 'todo'), title: parsed.title }
    const problem = taskLimitError(task)
    if (problem) {
      setNotice(problem)
      return
    }
    void taskBoard.saveTask(null, task, true)
    setNotice(`Added “${parsed.title}” to ${whenLabel(parsed.day)}`)
  }

  const focusSearch = () => searchRef.current?.focus()
  const paletteCommands: PaletteCommand[] = [
    ...(readOnly ? [] : [{ id: 'new-task', label: 'New task', run: actions.onAddInbox }]),
    { id: 'today', label: 'Go to today', run: onToday },
    ...VIEWS.map((v) => ({
      id: `view-${v.key}`,
      label: `${v.label} view`,
      run: () => changeView(v.key),
    })),
    ...THEME_OPTIONS.map((t) => ({
      id: `theme-${t.key}`,
      label: `Theme: ${t.label}`,
      run: () => setTheme(t.key),
    })),
    { id: 'search', label: 'Search tasks', run: focusSearch },
    ...(readOnly
      ? []
      : [
          {
            id: 'select',
            label: selecting ? 'Stop selecting tasks' : 'Select tasks',
            run: () => (selecting ? exitSelection() : setSelecting(true)),
          },
        ]),
    { id: 'help', label: 'Keyboard shortcuts', run: () => setHelpOpen(true) },
  ]

  const onShortcut = (action: ShortcutAction) => {
    switch (action.type) {
      case 'palette':
        setPaletteOpen(true)
        break
      case 'new-task':
        if (!readOnly) actions.onAddInbox()
        break
      case 'today':
        onToday()
        break
      case 'view':
        changeView(action.view)
        break
      case 'search':
        focusSearch()
        break
      case 'help':
        setHelpOpen(true)
        break
    }
  }
  // Escape leaves selection mode, unless a dialog that owns Escape is open over the board.
  const escapeExits = selectionActive && !paletteOpen && !helpOpen && editing === null
  useEffect(() => {
    if (!escapeExits) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      // Escape inside a text field or menu belongs to that control (clearing a search, closing a
      // Board-name input), even when the control does not claim it with preventDefault.
      const target = e.target
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
      )
        return
      setSelecting(false)
      setSelectedIds(new Set())
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [escapeExits])

  useKeyboardShortcuts({
    characterShortcuts: keyboardShortcuts,
    // A keyboard drag counts as blocking too: "t" mid-drag would move the calendar under the card
    // being carried.
    blocked: editing !== null || paletteOpen || helpOpen || dnd.activeTask !== null,
    onAction: onShortcut,
  })

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

        <SearchFilterBar
          query={filter}
          onChange={setFilter}
          searchInputRef={searchRef}
          selecting={selectionActive}
          onToggleSelect={
            readOnly ? undefined : () => (selecting ? exitSelection() : setSelecting(true))
          }
        />

        <DndContext
          accessibility={{ screenReaderInstructions: DND_INSTRUCTIONS }}
          sensors={dnd.sensors}
          collisionDetection={dnd.collisionDetection}
          onDragStart={dnd.onDragStart}
          onDragOver={dnd.onDragOver}
          onDragEnd={dnd.onDragEnd}
          onDragCancel={dnd.onDragCancel}
        >
          {/* Selection claims clicks and Enter, so drag is off while it lasts — via this context,
              never by changing the sensors array (see docs/agents/drag-and-drop.md). */}
          <DragDisabledContext.Provider value={filterActive || readOnly || selectionActive}>
            <main
              style={{
                display: 'flex',
                gap: isMobile ? 10 : 18,
                flex: 1,
                minHeight: 0,
                padding: isMobile ? '10px 10px 12px' : '18px 22px 22px',
                // Reserve the action bar's footprint (desktop floats it 20px up).
                ...(selectionActive && {
                  paddingBottom: barHeight + (isMobile ? 12 : 20 + 12),
                }),
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
            boardId={boardId}
          />
        )}

        {paletteOpen && (
          <CommandPalette
            commands={paletteCommands}
            quickAddPreview={quickAddPreview}
            onQuickAdd={quickAdd}
            onClose={() => setPaletteOpen(false)}
          />
        )}
        {helpOpen && (
          <ShortcutHelp
            characterShortcuts={keyboardShortcuts}
            onClose={() => setHelpOpen(false)}
            onOpenSettings={onOpenSettings}
          />
        )}
        {selectionActive && (
          <BulkActionBar
            count={selection.size}
            today={today}
            onApply={applyBulk}
            onDelete={deleteSelection}
            onDone={exitSelection}
            onHeightChange={setBarHeight}
          />
        )}
        {taskBoard.lastUndo ? (
          // Keyed by the action, so each new undoable action restarts the 6-second window even
          // when its label repeats (completing two tasks with the same title).
          <Toast
            key={taskBoard.lastUndo.id}
            tone="info"
            message={taskBoard.lastUndo.label}
            duration={6000}
            onDismiss={taskBoard.dismissUndo}
            action={readOnly ? undefined : { label: 'Undo', onClick: undoLast }}
            bottom={toastBottom}
          />
        ) : (
          notice && (
            <Toast
              tone="info"
              message={notice}
              onDismiss={() => setNotice(null)}
              bottom={toastBottom}
            />
          )
        )}
      </div>
    </BoardActionContext.Provider>
  )
}
