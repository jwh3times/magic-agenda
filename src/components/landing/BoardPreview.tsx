import { useMemo } from 'react'
import type { Task, ThemeName } from '../../types/task'
import { makeMockTasks } from '../../data/mockTasks'
import { ThemeProvider, useTheme } from '../../theme/ThemeProvider'
import { cellChrome, weekdayStyle } from '../../theme/chrome'
import { TaskCard } from '../TaskCard'
import { addDays, ymd, WEEKDAYS_SHORT } from '../../lib/dates'
import { useIsMobile } from '../../lib/useMediaQuery'

/**
 * A real board, rendered small, for the signed-out landing page.
 *
 * This is not a screenshot and not a mockup: it renders the actual `TaskCard` against the actual
 * theme tokens, so it cannot drift from the product. With no `BoardActionContext`, `TaskCard`
 * defaults to decorative rendering; dnd-kit and Supabase therefore stay out of the landing chunk.
 *
 * It is DECORATION, not UI. It renders no handlers, and the wrapper marks it `inert` +
 * `aria-hidden` so a keyboard user tabbing the page never lands inside fake task cards.
 */

const COLUMNS_DESKTOP = 4
const COLUMNS_MOBILE = 2

/** Mock tasks, trimmed to the next few days and dressed up to show off the card features. */
function usePreviewTasks(columns: number): { dateStr: string; tasks: Task[] }[] {
  return useMemo(() => {
    const all = makeMockTasks()
    const days = Array.from({ length: columns }, (_, i) => ymd(addDays(new Date(), i)))

    return days.map((dateStr, col) => {
      const tasks = all
        .filter((t) => t.day === dateStr)
        .slice(0, 2)
        // The seed board has nothing pinned and nothing done; the whole point of the preview is
        // showing what a card can look like, so give the first column one of each.
        .map((t, row) => ({
          ...t,
          pinned: col === 0 && row === 0,
          status: col === 1 && row === 0 ? ('done' as const) : t.status,
          done: col === 1 && row === 0 ? true : t.done,
        }))
      return { dateStr, tasks }
    })
  }, [columns])
}

function PreviewGrid({ columns }: { columns: number }) {
  const { theme, conf } = useTheme()
  const days = usePreviewTasks(columns)
  const today = ymd(new Date())

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        gap: 8,
        padding: 12,
        borderRadius: 14,
        backgroundColor: conf.pageBg,
        backgroundImage: conf.pageImg,
        backgroundSize: conf.pageSize,
      }}
    >
      {days.map(({ dateStr, tasks }) => {
        const d = new Date(`${dateStr}T00:00:00`)
        const meta = {
          dateStr,
          dayNum: d.getDate(),
          dow: d.getDay(),
          inMonth: true,
          isToday: dateStr === today,
          isWeekend: d.getDay() === 0 || d.getDay() === 6,
        }
        const c = cellChrome(theme, conf, meta, false)
        return (
          <div key={dateStr} style={{ minWidth: 0 }}>
            <div style={weekdayStyle(theme, conf)}>{WEEKDAYS_SHORT[d.getDay()]}</div>
            <div style={{ ...c.cell, minHeight: 132 }}>
              <div style={c.head}>
                <span style={c.numStyle}>{meta.dayNum}</span>
              </div>
              <div style={c.notesWrap}>
                {tasks.map((task) => (
                  <TaskCard key={task.id} task={task} variant="cell" />
                ))}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function BoardPreview({ theme }: { theme: ThemeName }) {
  const isMobile = useIsMobile()
  return (
    // `inert` keeps every card out of the tab order and off the accessibility tree; `aria-hidden`
    // is belt-and-braces for browsers that have not shipped inert. The page's real content says
    // what the product does — this only shows it.
    <div inert aria-hidden="true">
      <ThemeProvider initial={theme}>
        <PreviewGrid columns={isMobile ? COLUMNS_MOBILE : COLUMNS_DESKTOP} />
      </ThemeProvider>
    </div>
  )
}
