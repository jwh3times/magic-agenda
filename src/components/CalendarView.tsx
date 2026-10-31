import { useTheme } from '../theme/ThemeProvider'
import { boardChrome, weekdayStyle } from '../theme/chrome'
import { buildMonthGrid, notesForDay } from '../data/selectors'
import { useToday } from '../data/todayContext'
import { DayCell } from './DayCell'
import type { Task } from '../types/task'

export interface CalendarViewProps {
  viewY: number
  viewM: number
  /** 0=Sunday … 6=Saturday. */
  weekStart?: number
  tasks: Task[]
}

export function CalendarView({ viewY, viewM, weekStart = 0, tasks }: CalendarViewProps) {
  const { theme, conf } = useTheme()
  const b = boardChrome(theme, conf)
  const wd = weekdayStyle(theme, conf)
  const { weekdays, cells } = buildMonthGrid(viewY, viewM, useToday(), weekStart)

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
          <DayCell key={meta.dateStr} meta={meta} notes={notesForDay(tasks, meta.dateStr)} />
        ))}
      </div>
    </div>
  )
}
