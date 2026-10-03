import { useMemo, useState } from 'react'
import type { Task, ThemeName } from '../../types/task'
import { makeMockTasks } from '../../data/mockTasks'
import { ThemeProvider, useTheme } from '../../theme/ThemeProvider'
import { cellChrome, weekdayStyle } from '../../theme/chrome'
import { TaskCard } from '../TaskCard'
import { addDays, ymd, WEEKDAYS_SHORT } from '../../lib/dates'
import { useIsMobile } from '../../lib/useMediaQuery'
import { LabelDirectoryContext } from '../../labels/labelDirectoryContext'
import { MOCK_LABEL_DIRECTORY } from '../../data/mockLabels'
import { previewHeight } from './previewHeight'

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
function usePreviewTasks(columns: number, now: Date): { dateStr: string; tasks: Task[] }[] {
  return useMemo(() => {
    const all = makeMockTasks()
    const days = Array.from({ length: columns }, (_, i) => ymd(addDays(now, i)))

    return days.map((dateStr, col) => {
      const tasks = all
        .filter((t) => t.day === dateStr)
        .slice(0, 2)
        // The seed board has nothing pinned or Completed; the whole point of the preview is
        // showing what a card can look like, so give the first column one of each.
        .map((t, row) => ({
          ...t,
          pinned: col === 0 && row === 0,
          status: col === 1 && row === 0 ? ('completed' as const) : t.status,
          completedAt: null,
          reopenStatus: col === 1 && row === 0 ? 'todo' : t.reopenStatus,
          archivedAt: null,
        }))
      return { dateStr, tasks }
    })
  }, [columns, now])
}

function PreviewGrid({ columns, minHeight }: { columns: number; minHeight: number }) {
  const { theme, conf } = useTheme()
  // One instant for the whole preview, read once: `react/purity` forbids `new Date()` during render.
  const [now] = useState(() => new Date())
  const days = usePreviewTasks(columns, now)
  const today = ymd(now)

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        gap: 8,
        padding: 12,
        borderRadius: 14,
        // The landing page's reserved height (#499). The single row stretches to fill it, and each
        // column passes that on to its cell, so the extra space is board rather than a gap below it.
        minHeight,
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
        const c = cellChrome(theme, conf, meta)
        return (
          <div key={dateStr} style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            {/* `weekdayStyle` assumes the board's weekday strip behind it, which is dark in brutal
                and transparent elsewhere (`boardChrome().weekRow`). The preview has no strip, so
                each label carries the strip's colour itself (#502). */}
            <div style={{ ...weekdayStyle(theme, conf), background: conf.weekBg }}>
              {WEEKDAYS_SHORT[d.getDay()]}
            </div>
            <div style={{ ...c.cell, minHeight: 132, flex: 1 }}>
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
        <LabelDirectoryContext.Provider value={MOCK_LABEL_DIRECTORY}>
          <PreviewGrid
            columns={isMobile ? COLUMNS_MOBILE : COLUMNS_DESKTOP}
            minHeight={previewHeight(isMobile)}
          />
        </LabelDirectoryContext.Provider>
      </ThemeProvider>
    </div>
  )
}
