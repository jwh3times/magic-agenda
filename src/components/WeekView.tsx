import { useTheme } from '../theme/ThemeProvider'
import { boardChrome, scrollbars, weekdayStyle } from '../theme/chrome'
import { buildWeekCells, notesForDay } from '../data/selectors'
import { WEEKDAYS_SHORT } from '../lib/dates'
import { useToday } from '../data/todayContext'
import { useIsMobile } from '../lib/useMediaQuery'
import { DayCell } from './DayCell'
import type { Task } from '../types/task'

export interface WeekViewProps {
  weekStart: Date
  tasks: Task[]
}

export function WeekView({ weekStart, tasks }: WeekViewProps) {
  const { theme, conf } = useTheme()
  const isMobile = useIsMobile()
  const b = boardChrome(theme, conf)
  const wd = weekdayStyle(theme, conf)
  const cells = buildWeekCells(weekStart, useToday())

  if (isMobile) {
    // Phones: the seven days stack vertically (one scrollable column), each with its own label.
    return (
      <div style={b.boardWrap}>
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            ...scrollbars(conf),
            display: 'flex',
            flexDirection: 'column',
            gap: theme === 'brutal' ? 0 : 8,
          }}
        >
          {cells.map((meta) => (
            <div key={meta.dateStr} style={{ flex: 'none' }}>
              <div style={wd}>
                {WEEKDAYS_SHORT[meta.dow]} {meta.dayNum}
              </div>
              <div style={{ display: 'grid', minHeight: 96 }}>
                <DayCell meta={meta} notes={notesForDay(tasks, meta.dateStr)} />
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div style={b.boardWrap}>
      <div style={b.weekRow}>
        {cells.map((meta) => (
          <div key={meta.dateStr} style={wd}>
            {WEEKDAYS_SHORT[meta.dow]} {meta.dayNum}
          </div>
        ))}
      </div>
      <div style={{ ...b.grid, gridTemplateRows: '1fr' }}>
        {cells.map((meta) => (
          <DayCell key={meta.dateStr} meta={meta} notes={notesForDay(tasks, meta.dateStr)} />
        ))}
      </div>
    </div>
  )
}
