import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { ThemeProvider } from '../theme/ThemeProvider'
import { CHARACTER_SHORTCUTS } from '../lib/keyboardShortcuts'
import { ShortcutHelp } from './ShortcutHelp'

function setup(characterShortcuts = true) {
  const onClose = vi.fn()
  const onOpenSettings = vi.fn()
  const view = render(
    <ThemeProvider>
      <ShortcutHelp
        characterShortcuts={characterShortcuts}
        onClose={onClose}
        onOpenSettings={onOpenSettings}
      />
    </ThemeProvider>,
  )
  return { onClose, onOpenSettings, view, user: userEvent.setup() }
}

test('lists the palette and every single-character shortcut from the shared table', () => {
  setup()
  expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInTheDocument()
  expect(screen.getByText('Open the command palette')).toBeInTheDocument()
  expect(screen.getByText('Ctrl/⌘ K')).toBeInTheDocument()
  for (const shortcut of CHARACTER_SHORTCUTS) {
    expect(screen.getByText(shortcut.label)).toBeInTheDocument()
    expect(screen.getByText(shortcut.keys)).toBeInTheDocument()
  }
})

test('says nothing about being turned off when shortcuts are on', () => {
  setup(true)
  expect(screen.queryByRole('note')).not.toBeInTheDocument()
})

test('when shortcuts are off, says so and links to Settings', async () => {
  const { onOpenSettings, user } = setup(false)
  expect(screen.getByRole('note')).toHaveTextContent(/turned off for your account/)
  await user.click(screen.getByRole('button', { name: 'Turn them on in Settings' }))
  expect(onOpenSettings).toHaveBeenCalled()
})

test('Escape closes it', async () => {
  const { onClose, user } = setup()
  await user.keyboard('{Escape}')
  expect(onClose).toHaveBeenCalled()
})

test('the close button and the backdrop close it, but a click inside does not', async () => {
  const { onClose, view, user } = setup()
  await user.click(screen.getByRole('heading', { name: 'Keyboard shortcuts' }))
  expect(onClose).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Close' }))
  expect(onClose).toHaveBeenCalledTimes(1)
  await user.click(view.container.firstChild as HTMLElement)
  expect(onClose).toHaveBeenCalledTimes(2)
})
