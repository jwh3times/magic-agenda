import { DndContext } from '@dnd-kit/core'
import { render, screen } from '@testing-library/react'
import { afterEach, test, vi } from 'vitest'
import { ThemeProvider } from '../theme/ThemeProvider'
import { KanbanView } from './KanbanView'

afterEach(() => vi.unstubAllGlobals())

test('renders swipeable near-full-width columns on mobile', () => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      matches: true,
      addEventListener: () => {},
      removeEventListener: () => {},
    })),
  )
  const { container } = render(
    <DndContext>
      <ThemeProvider>
        <KanbanView tasks={[]} />
      </ThemeProvider>
    </DndContext>,
  )

  const scroller = [...container.querySelectorAll<HTMLDivElement>('div')].find(
    (element) => element.style.overflowX === 'auto',
  )
  expect(scroller).toHaveStyle({ overflowX: 'auto', scrollSnapType: 'x mandatory' })
  expect(scroller?.children).toHaveLength(3)
  const firstColumn = scroller?.firstElementChild as HTMLElement
  expect(firstColumn.style.width).toBe('84vw')
  expect(firstColumn.style.scrollSnapAlign).toBe('start')
  expect(screen.getByText('To Do')).toBeInTheDocument()
  expect(screen.getByText('In Progress')).toBeInTheDocument()
  expect(screen.getByText('Completed')).toBeInTheDocument()
})
