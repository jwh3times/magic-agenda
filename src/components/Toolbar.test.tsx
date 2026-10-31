import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
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

test('the toolbar is a banner landmark carrying the page heading', () => {
  renderToolbar()
  expect(screen.getByRole('banner')).toBeInTheDocument()
  expect(screen.getByRole('heading', { level: 1, name: 'Magic Agenda' })).toBeInTheDocument()
})

// jsdom has no matchMedia, so the test above renders the desktop branch. The mobile branch is a
// separate JSX tree and needs the same treatment or the phone layout keeps failing both rules.
const stubMobile = () =>
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} })),
  )

test('the mobile toolbar is a banner landmark carrying the page heading', () => {
  stubMobile()
  try {
    renderToolbar()
    expect(screen.getByRole('banner')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Magic Agenda' })).toBeInTheDocument()
  } finally {
    vi.unstubAllGlobals()
  }
})

describe('phone controls (#564)', () => {
  afterEach(() => vi.unstubAllGlobals())

  test('Sign out leaves the phone header', () => {
    stubMobile()
    renderToolbar({ onSignOut: () => {} })
    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument()
  })

  test('the controls button reports whether the controls are open, and toggles them', async () => {
    stubMobile()
    const onToggleControls = vi.fn()
    renderToolbar({ onToggleControls, controlsOpen: false })
    const button = screen.getByRole('button', { name: 'Search and filters' })
    expect(button).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(button)
    expect(onToggleControls).toHaveBeenCalledTimes(1)
  })

  test('an active filter is part of the controls button’s name', () => {
    stubMobile()
    renderToolbar({ onToggleControls: () => {}, filterActive: true })
    expect(
      within(
        screen.getByRole('button', { name: 'Search and filters, filters active' }),
      ).getByTestId('filter-marker'),
    ).toBeInTheDocument()
  })

  test('no filter, no marker', () => {
    stubMobile()
    renderToolbar({ onToggleControls: () => {} })
    expect(screen.queryByTestId('filter-marker')).not.toBeInTheDocument()
  })

  test('New task keeps its full name where only the plus shows', () => {
    stubMobile()
    renderToolbar()
    expect(screen.getByRole('button', { name: '+ New task' })).toHaveTextContent(/^\+$/)
  })

  test('the desktop toolbar keeps Sign out and has no controls button', () => {
    renderToolbar({ onSignOut: () => {}, onToggleControls: () => {} })
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Search and filters/ })).not.toBeInTheDocument()
  })
})
