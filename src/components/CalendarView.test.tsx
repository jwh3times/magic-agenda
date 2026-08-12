import { DndContext } from '@dnd-kit/core'
import { render } from '@testing-library/react'
import { afterEach, test, vi } from 'vitest'
import { TodayContext } from '../data/todayContext'
import { ThemeProvider } from '../theme/ThemeProvider'
import { CalendarView } from './CalendarView'

afterEach(() => vi.unstubAllGlobals())

function stubMobile() {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      matches: true,
      addEventListener: () => {},
      removeEventListener: () => {},
    })),
  )
}

test('keeps the month grid readable inside a horizontal mobile scroller', () => {
  stubMobile()
  const { container } = render(
    <DndContext>
      <ThemeProvider>
        <TodayContext.Provider value="2026-03-15">
          <CalendarView viewY={2026} viewM={2} tasks={[]} />
        </TodayContext.Provider>
      </ThemeProvider>
    </DndContext>,
  )

  const scroller = [...container.querySelectorAll<HTMLDivElement>('div')].find(
    (element) => element.style.overflowX === 'auto',
  )
  expect(scroller).toHaveStyle({ overflowX: 'auto', scrollbarWidth: 'thin' })
  expect(scroller?.firstElementChild).toHaveStyle({ minWidth: '640px' })
})
