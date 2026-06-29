import { useTheme } from '../theme/ThemeProvider'
import { boardChrome, weekdayStyle } from '../theme/chrome'
import { buildMonthGrid, notesForDay } from '../data/selectors'
import { ymd } from '../lib/dates'
import { DayCell } from './DayCell'
import type { Task } from '../types/task'
import type { BoardHandlers, PopId } from './boardHandlers'

export interface CalendarViewProps {
  viewY: number
  viewM: number
  tasks: Task[]
  handlers: BoardHandlers
  pop: PopId
}

export function CalendarView({ viewY, viewM, tasks, handlers, pop }: CalendarViewProps) {
  const { theme, conf } = useTheme()
  const b = boardChrome(theme, conf)
  const wd = weekdayStyle(theme, conf)
  const { weekdays, cells } = buildMonthGrid(viewY, viewM, ymd(new Date()))

  return (
    <div style={b.boardWrap}>
      <div style={b.weekRow}>
        {weekdays.map((w) => (
          <div key={w} style={wd}>
            {w}
          </div>
        ))}
      </div>
      <div style={b.grid}>
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
