import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { ThemeProvider } from '../theme/ThemeProvider'
import { CommandPalette, type PaletteCommand, type QuickAddPreview } from './CommandPalette'

function setup(
  preview: (text: string) => QuickAddPreview | null = (text) => ({
    title: text.trim(),
    when: 'Inbox',
  }),
) {
  const runs = { today: vi.fn(), week: vi.fn(), help: vi.fn() }
  const commands: PaletteCommand[] = [
    { id: 'today', label: 'Go to today', run: runs.today },
    { id: 'week', label: 'Week view', run: runs.week },
    { id: 'help', label: 'Keyboard shortcuts', run: runs.help },
  ]
  const onQuickAdd = vi.fn()
  const onClose = vi.fn()
  render(
    <ThemeProvider>
      <CommandPalette
        commands={commands}
        quickAddPreview={preview}
        onQuickAdd={onQuickAdd}
        onClose={onClose}
      />
    </ThemeProvider>,
  )
  const input = screen.getByRole('combobox', { name: 'Type a command, or a task to add' })
  const options = () => within(screen.getByRole('listbox')).queryAllByRole('option')
  return { runs, onQuickAdd, onClose, input, options, user: userEvent.setup() }
}

test('opens as a labelled dialog with the field focused and every command listed', () => {
  const { input, options } = setup()
  expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeInTheDocument()
  expect(input).toHaveFocus()
  expect(options().map((o) => o.textContent)).toEqual([
    'Go to today',
    'Week view',
    'Keyboard shortcuts',
  ])
})

test('typing puts "Add task" first, with its preview, above the commands that match', async () => {
  const { input, options, user } = setup(() => ({ title: 'groceries', when: 'Friday, Sep 11' }))
  await user.type(input, 'week')
  expect(options().map((o) => o.textContent)).toEqual([
    'Add task “groceries”Friday, Sep 11',
    'Week view',
  ])
})

test('Enter on the first row creates the task from the typed text and closes', async () => {
  const { input, onQuickAdd, onClose, user } = setup()
  await user.type(input, 'groceries tomorrow{Enter}')
  expect(onQuickAdd).toHaveBeenCalledWith('groceries tomorrow')
  expect(onClose).toHaveBeenCalled()
})

test('the arrow keys move the highlighted row, and Enter runs it instead', async () => {
  const { input, options, runs, onQuickAdd, onClose, user } = setup()
  await user.type(input, 'o')
  // Rows: Add task "o", Go to today, Keyboard shortcuts ("Week view" has no "o").
  await user.keyboard('{ArrowDown}')
  expect(options()[1]).toHaveAttribute('aria-selected', 'true')
  expect(input).toHaveAttribute('aria-activedescendant', options()[1].id)
  await user.keyboard('{Enter}')
  expect(runs.today).toHaveBeenCalled()
  expect(onQuickAdd).not.toHaveBeenCalled()
  expect(onClose).toHaveBeenCalled()
})

test('ArrowUp from the first row wraps to the last', async () => {
  const { input, options, user } = setup()
  input.focus()
  await user.keyboard('{ArrowUp}')
  expect(options()[2]).toHaveAttribute('aria-selected', 'true')
})

test('no "Add task" row when quick-add is unavailable', async () => {
  const { input, options, user } = setup(() => null)
  await user.type(input, 'week')
  expect(options().map((o) => o.textContent)).toEqual(['Week view'])
})

test('says so when nothing matches and quick-add is unavailable', async () => {
  const { input, options, user } = setup(() => null)
  await user.type(input, 'zzz')
  expect(options()).toHaveLength(0)
  expect(screen.getByText('No matching commands')).toBeInTheDocument()
})

test('Escape closes without running anything', async () => {
  const { input, runs, onQuickAdd, onClose, user } = setup()
  await user.type(input, 'week{Escape}')
  expect(onClose).toHaveBeenCalled()
  expect(runs.week).not.toHaveBeenCalled()
  expect(onQuickAdd).not.toHaveBeenCalled()
})

test('clicking a command runs it and closes, and keeps focus in the field until then', async () => {
  const { input, options, runs, onClose, user } = setup()
  await user.click(options()[2])
  expect(runs.help).toHaveBeenCalled()
  expect(onClose).toHaveBeenCalled()
  expect(input).toHaveFocus()
})
