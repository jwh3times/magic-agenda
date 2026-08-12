import { DndContext } from '@dnd-kit/core'
import { render, screen } from '@testing-library/react'
import { afterEach, test, vi } from 'vitest'
import { TodayContext } from '../data/todayContext'
import { ThemeProvider } from '../theme/ThemeProvider'
import { WeekView } from './WeekView'

afterEach(() => vi.unstubAllGlobals())

function renderWeek() {
  return render(
    <DndContext>
      <ThemeProvider>
        <TodayContext.Provider value="2026-03-15">
          <WeekView weekStart={new Date('2026-03-15T00:00:00')} tasks={[]} />
        </TodayContext.Provider>
      </ThemeProvider>
    </DndContext>,
  )
}

test('uses the themed scrollable board grid on desktop', () => {
  const { container } = renderWeek()
  const grid = [...container.querySelectorAll<HTMLDivElement>('div')].find(
    (element) => element.style.display === 'grid' && element.style.overflow === 'auto',
  )
  expect(grid).toHaveStyle({ overflow: 'auto', scrollbarWidth: 'thin' })
})

test('stacks all seven days in a vertical mobile scroller', () => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      matches: true,
      addEventListener: () => {},
      removeEventListener: () => {},
    })),
  )
  const { container } = renderWeek()

  const scroller = [...container.querySelectorAll<HTMLDivElement>('div')].find(
    (element) => element.style.overflowY === 'auto',
  )
  expect(scroller).toHaveStyle({ overflowY: 'auto', scrollbarWidth: 'thin' })
  expect(screen.getByText('Sun 15')).toBeInTheDocument()
  expect(screen.getByText('Sat 21')).toBeInTheDocument()
})
