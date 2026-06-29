import { useTheme } from '../theme/ThemeProvider'
import { boardChrome, weekdayStyle } from '../theme/chrome'
import { buildWeekCells, notesForDay } from '../data/selectors'
import { ymd, WEEKDAYS_SHORT } from '../lib/dates'
import { DayCell } from './DayCell'
import type { Task } from '../types/task'
import type { BoardHandlers, PopId } from './boardHandlers'

export interface WeekViewProps {
  weekStart: Date
  tasks: Task[]
  handlers: BoardHandlers
  pop: PopId
}

export function WeekView({ weekStart, tasks, handlers, pop }: WeekViewProps) {
  const { theme, conf } = useTheme()
  const b = boardChrome(theme, conf)
  const wd = weekdayStyle(theme, conf)
  const cells = buildWeekCells(weekStart, ymd(new Date()))

  return (
    <div style={b.boardWrap}>
      <div style={b.weekRow}>
        {cells.map((meta, i) => (
          <div key={meta.dateStr} style={wd}>
            {WEEKDAYS_SHORT[i]} {meta.dayNum}
          </div>
        ))}
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(7,1fr)',
          gridTemplateRows: '1fr',
          gap: theme === 'brutal' ? '0' : '6px',
          flex: 1,
          minHeight: 0,
        }}
      >
        {cells.map((meta) => (
          <DayCell
            key={meta.dateStr}
            meta={meta}
            notes={notesForDay(tasks, meta.dateStr)}
            handlers={handlers}
            pop={pop}
          />
        ))}
      </div>
    </div>
  )
}
