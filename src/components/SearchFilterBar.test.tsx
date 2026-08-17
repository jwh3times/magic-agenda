import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { ThemeProvider } from '../theme/ThemeProvider'
import { SearchFilterBar } from './SearchFilterBar'
import { EMPTY_FILTER, type FilterQuery } from '../data/filters'
import { LabelDirectoryContext } from '../labels/labelDirectoryContext'
import { fakeLabel, fakeLabelDirectory } from '../labels/fakeLabelDirectory'

const directory = fakeLabelDirectory({
  labels: [fakeLabel(), fakeLabel({ id: 'l2', name: 'Errands', position: 1 })],
})

function renderBar(query: FilterQuery, onChange: (q: FilterQuery) => void) {
  return render(
    <ThemeProvider>
      <LabelDirectoryContext.Provider value={directory}>
        <SearchFilterBar query={query} onChange={onChange} />
      </LabelDirectoryContext.Provider>
    </ThemeProvider>,
  )
}

test('clicking the pinned button toggles query.pinned on via onChange', async () => {
  const onChange = vi.fn()
  renderBar(EMPTY_FILTER, onChange)
  await userEvent.click(screen.getByRole('button', { name: 'Show pinned only' }))
  expect(onChange).toHaveBeenCalledWith({ ...EMPTY_FILTER, pinned: true })
})

test('when pinned is active, the button reflects its active state and toggles off', async () => {
  const onChange = vi.fn()
  const query: FilterQuery = { ...EMPTY_FILTER, pinned: true }
  renderBar(query, onChange)
  const button = screen.getByRole('button', { name: 'Show all tasks' })
  expect(button).toBeInTheDocument()
  await userEvent.click(button)
  expect(onChange).toHaveBeenCalledWith({ ...query, pinned: false })
})

test('the filter bar is a search landmark and every control has an accessible name', () => {
  // A tag-level check, not getByRole('search'): aria-query 5.3.0 has no <search> mapping, so
  // jsdom cannot resolve the implicit landmark role. Adding an explicit role="search" to satisfy
  // getByRole would make this assertion pass for <div role="search"> too — which is the exact
  // substitution this test exists to prevent. Real browsers and axe-core see the implicit role.
  const { container } = renderBar(EMPTY_FILTER, vi.fn())
  expect(container.querySelector('search')).not.toBeNull()
  expect(screen.getByRole('combobox', { name: 'Filter by label' })).toBeInTheDocument()
  expect(screen.getByRole('combobox', { name: 'Filter by status' })).toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: 'Search tasks' })).toBeInTheDocument()
})

test('offers All labels, Unlabeled, and the selected Board’s Labels', async () => {
  const onChange = vi.fn()
  renderBar(EMPTY_FILTER, onChange)
  const select = screen.getByRole('combobox', { name: 'Filter by label' })

  expect(screen.getByRole('option', { name: 'All labels' })).toBeInTheDocument()
  expect(screen.getByRole('option', { name: 'Unlabeled' })).toBeInTheDocument()
  expect(screen.getByRole('option', { name: 'Work' })).toBeInTheDocument()
  expect(screen.getByRole('option', { name: 'Errands' })).toBeInTheDocument()

  await userEvent.selectOptions(select, 'l2')
  expect(onChange).toHaveBeenCalledWith({ ...EMPTY_FILTER, labelId: 'l2' })
})
