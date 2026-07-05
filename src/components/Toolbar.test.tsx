import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { ThemeProvider } from '../theme/ThemeProvider'
import { Toolbar } from './Toolbar'

test('the settings gear invokes onOpenSettings', async () => {
  const onOpenSettings = vi.fn()
  render(
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
      />
    </ThemeProvider>,
  )
  await userEvent.click(screen.getByRole('button', { name: 'Settings' }))
  expect(onOpenSettings).toHaveBeenCalledTimes(1)
})
