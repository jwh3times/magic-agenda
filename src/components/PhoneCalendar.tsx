import { useCallback, useContext, useId, useRef, useState, type KeyboardEvent } from 'react'
import { useTheme } from '../theme/ThemeProvider'
import { dayMarkerStyle, phoneDayChrome, phoneMonthChrome, phonePanelChrome } from '../theme/chrome'
import {
  buildMonthGrid,
  dayCellName,
  dayMarkers,
  defaultSelectedDay,
  notesForDay,
  taskCount,
  type CellMeta,
  type DayMarker,
} from '../data/selectors'
import { OfflineContext } from '../data/offlineContext'
import { useToday } from '../data/todayContext'
import { useDueClock } from '../data/dueClockContext'
import { useLabel } from '../labels/LabelDirectoryProvider'
import { labelPresentation } from '../labels/presentation'
import { formatDayShort, MONTHS_LONG } from '../lib/dates'
import { DropLane } from '../dnd/DropLane'
import { usePanelDragHold, useDropTarget } from '../dnd/phoneDrag'
import { SortableCard } from '../dnd/SortableCard'
import { INBOX, type Task } from '../types/task'
import { useBoardActions } from './boardActionContext'
import { BoardLegalLinks } from './BoardLegalLinks'

export interface PhoneCalendarProps {
  viewY: number
  viewM: number
  /** 0=Sunday … 6=Saturday. */
  weekStart?: number
  tasks: Task[]
  /** Counts the Today action's uses, because Today in the visible month changes no other prop. */
  todayRequest: number
}

type PanelTab = 'day' | 'inbox'

function Marker({ marker }: { marker: DayMarker }) {
  const { conf } = useTheme()
  const { dotColor } = labelPresentation(useLabel(marker.labelId))
  return (
    <span
      data-testid="day-marker"
      data-kind={marker.kind}
      style={dayMarkerStyle(marker.kind, dotColor, conf)}
    />
  )
}

function PhoneDay({
  meta,
  tasks,
  selected,
  dropsDisabled,
  onSelect,
}: {
  meta: CellMeta
  tasks: Task[]
  selected: boolean
  dropsDisabled: boolean
  onSelect: (day: string) => void
}) {
  const { theme, conf } = useTheme()
  const { nowMs, timezone } = useDueClock()
  const { setNodeRef, isOver } = useDropTarget(meta.dateStr, dropsDisabled)
  const summary = dayMarkers(tasks, meta.dateStr, nowMs, timezone)
  const c = phoneDayChrome(theme, conf, meta, selected, isOver)
  return (
    <button
      ref={setNodeRef}
      type="button"
      aria-label={dayCellName(meta.dateStr, summary)}
      aria-pressed={selected}
      aria-current={meta.isToday ? 'date' : undefined}
      style={c.cell}
      onClick={() => onSelect(meta.dateStr)}
    >
      <span style={c.num}>{meta.dayNum}</span>
      {/* Hidden because the button's name already says all of this. */}
      <span aria-hidden="true" style={c.markers}>
        {summary.markers.map((marker) => (
          <Marker key={marker.taskId} marker={marker} />
        ))}
        {summary.more > 0 && <span style={c.more}>+{summary.more}</span>}
      </span>
    </button>
  )
}

/**
 * The Calendar view at or below the phone breakpoint (#565): the whole month as markers, and below
 * it one panel that lists either the selected day or the Inbox. Selected day and tab are deliberately
 * only this component's state, so a reload starts fresh from today.
 *
 * A panel card can be dragged onto a day or the Inbox tab (#566), which highlight and take the move
 * on drop. See docs/agents/drag-and-drop.md.
 */
export function PhoneCalendar({
  viewY,
  viewM,
  weekStart = 0,
  tasks,
  todayRequest,
}: PhoneCalendarProps) {
  const actions = useBoardActions()
  const { theme, conf } = useTheme()
  const { readOnly } = useContext(OfflineContext)
  const today = useToday()
  const [picked, setPicked] = useState<string | null>(null)
  const [tab, setTab] = useState<PanelTab>('day')

  // A tap lasts until the visible month changes, so coming back to a month starts again from the
  // rule rather than from the old tap. Today always wins, and has to show today even from the Inbox.
  const [seen, setSeen] = useState({ viewY, viewM, todayRequest })
  if (seen.viewY !== viewY || seen.viewM !== viewM || seen.todayRequest !== todayRequest) {
    setSeen({ viewY, viewM, todayRequest })
    setPicked(null)
    if (seen.todayRequest !== todayRequest) setTab('day')
  }

  const { day: selected, dropsDisabled } = usePanelDragHold(
    picked ?? defaultSelectedDay(viewY, viewM, today),
  )
  const { weekdays, cells } = buildMonthGrid(viewY, viewM, today, weekStart)
  const dayNotes = notesForDay(tasks, selected)
  const inboxNotes = notesForDay(tasks, INBOX)
  const dayLabel = formatDayShort(selected)
  const panel =
    tab === 'day'
      ? {
          lane: selected,
          notes: dayNotes,
          addLabel: `Add a task on ${dayLabel}`,
          add: () => actions?.onAddDay(selected),
          empty: `Nothing on ${dayLabel}`,
        }
      : {
          lane: INBOX,
          notes: inboxNotes,
          addLabel: 'Add to inbox',
          add: () => actions?.onAddInbox(),
          empty: 'Nothing in the Inbox',
        }

  const baseId = useId()
  const panelId = `${baseId}-panel`
  const tabId = (which: PanelTab) => `${baseId}-${which}`
  const dayTabRef = useRef<HTMLButtonElement>(null)
  const inboxTabRef = useRef<HTMLButtonElement>(null)
  const { setNodeRef: setInboxTarget, isOver: overInboxTab } = useDropTarget(INBOX, dropsDisabled)
  const setInboxTab = useCallback(
    (node: HTMLButtonElement | null) => {
      inboxTabRef.current = node
      setInboxTarget(node)
    },
    [setInboxTarget],
  )

  // Two tabs, so either arrow reaches the other one.
  const onTabKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const next = tab === 'day' ? 'inbox' : 'day'
    setTab(next)
    ;(next === 'day' ? dayTabRef : inboxTabRef).current?.focus()
  }

  const selectDay = (day: string) => {
    setPicked(day)
    setTab('day')
  }

  const m = phoneMonthChrome(theme, conf)
  const p = phonePanelChrome(theme, conf)
  const tabs: {
    key: PanelTab
    label: string
    count: number
    ref: typeof dayTabRef | typeof setInboxTab
    dropOver?: boolean
  }[] = [
    { key: 'day', label: dayLabel, count: dayNotes.length, ref: dayTabRef },
    {
      key: 'inbox',
      label: 'Inbox',
      count: inboxNotes.length,
      ref: setInboxTab,
      dropOver: overInboxTab,
    },
  ]

  return (
    <div style={m.root}>
      <div style={m.wrap}>
        <div style={m.weekRow}>
          {weekdays.map((weekday) => (
            <div key={weekday} style={m.weekday}>
              {weekday}
            </div>
          ))}
        </div>
        <div role="group" aria-label={`${MONTHS_LONG[viewM]} ${viewY}`} style={m.grid}>
          {cells.map((meta) => (
            <PhoneDay
              key={meta.dateStr}
              meta={meta}
              tasks={tasks}
              selected={meta.dateStr === selected}
              dropsDisabled={dropsDisabled}
              onSelect={selectDay}
            />
          ))}
        </div>
      </div>

      <div style={p.panel}>
        <div style={p.head}>
          <div role="tablist" aria-label="Day and Inbox" style={p.tabs}>
            {tabs.map(({ key, label, count, ref, dropOver }) => (
              <button
                key={key}
                ref={ref}
                id={tabId(key)}
                type="button"
                role="tab"
                aria-selected={tab === key}
                aria-controls={panelId}
                aria-label={`${label}, ${taskCount(count)}`}
                tabIndex={tab === key ? 0 : -1}
                style={{ ...(tab === key ? p.tabActive : p.tab), ...(dropOver && p.tabDropOver) }}
                onClick={() => setTab(key)}
                onKeyDown={onTabKeyDown}
              >
                {/* The space keeps the text "Inbox 1", not "Inbox1", so a voice-control user who
                    says what they see still matches the name above. The flex gap does the spacing. */}
                {label} <span style={p.count}>{count}</span>
              </button>
            ))}
          </div>
          {/* Absent while read-only, like the Toolbar's disabled New task: the editor it would open
              could not save anything. */}
          {!readOnly && (
            <button
              type="button"
              aria-label={panel.addLabel}
              title={panel.addLabel}
              style={p.add}
              onClick={panel.add}
            >
              +
            </button>
          )}
        </div>
        <div role="tabpanel" id={panelId} aria-labelledby={tabId(tab)} style={p.body}>
          <DropLane
            key={panel.lane}
            id={panel.lane}
            itemIds={panel.notes.map((note) => note.id)}
            style={p.list}
          >
            {panel.notes.map((task) => (
              <SortableCard key={task.id} task={task} variant="inbox" />
            ))}
            {panel.notes.length === 0 && <div style={p.empty}>{panel.empty}</div>}
            {panel.notes.length === 0 && tab === 'day' && !readOnly && (
              <button type="button" style={p.emptyAdd} onClick={panel.add}>
                + Add a task
              </button>
            )}
          </DropLane>
          {tab === 'inbox' && <BoardLegalLinks />}
        </div>
      </div>
    </div>
  )
}
