import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { ThemeProvider } from '../theme/ThemeProvider'
import { Toolbar, type ToolbarProps } from './Toolbar'

function renderToolbar(overrides: Partial<ToolbarProps> = {}) {
  const onOpenSettings = overrides.onOpenSettings ?? vi.fn()
  return render(
    <ThemeProvider>
      <Toolbar
        views={[{ key: 'calendar', label: 'Calendar' }]}
        view="calendar"
        onChangeView={() => {}}
        showNav={false}
        navLabel=""
        onPrev={() => {}}
        onNext={() => {}}
        onToday={() => {}}
        onAddInbox={() => {}}
        onOpenSettings={onOpenSettings}
        {...overrides}
      />
    </ThemeProvider>,
  )
}

test('the settings gear invokes onOpenSettings', async () => {
  const onOpenSettings = vi.fn()
  renderToolbar({ onOpenSettings })
  await userEvent.click(screen.getByRole('button', { name: 'Settings' }))
  expect(onOpenSettings).toHaveBeenCalledTimes(1)
})

test('the Today button shows the overdue count when nonzero', () => {
  renderToolbar({ showNav: true, navLabel: 'July 2026', overdueCount: 3 })
  expect(screen.getByRole('button', { name: 'Today (3)' })).toBeInTheDocument()
})
