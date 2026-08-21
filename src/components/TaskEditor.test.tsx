import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { ThemeProvider } from '../theme/ThemeProvider'
import { TaskEditor } from './TaskEditor'
import { asTask, NO_RECUR, type Task, type TaskDraft } from '../types/task'
import type { ReactNode } from 'react'
import { LabelDirectoryContext } from '../labels/labelDirectoryContext'
import { fakeLabelDirectory } from '../labels/fakeLabelDirectory'

function mkInstance(over: Partial<TaskDraft> = {}): Task {
  return asTask({
    id: 'inst-1',
    title: 'Water the plants',
    description: '',
    labelId: null,
    color: 'yellow',
    checklist: [],
    status: 'todo',
    done: false,
    day: '2026-07-10',
    atTime: null,
    pinned: false,
    order: 0,
    korder: 0,
    ...NO_RECUR,
    // A materialized Occurrence of a Recurring Series. Both fields are required to make one: a
    // parent without an Occurrence Date is not an Occurrence, and `asTask` reads it as standalone.
    recurParentId: 'template-1',
    occurrenceDate: '2026-07-10',
    ...over,
  })
}

/**
 * An Occurrence's draft as `Board.openTask` builds it: the row plus its Series' Recurrence Rule,
 * which is what the Repeat controls edit.
 *
 * `mkInstance` cannot express this — `asTask` narrows a parented row to an `Occurrence` and forces
 * `recurFreq` back to `'none'`. A test that skips this helper is therefore editing a draft the app
 * never produces, which is exactly how the removal path used to go untested (see the twin helper
 * in `src/data/series.test.ts`).
 */
function editing(over: Partial<TaskDraft> = {}): TaskDraft {
  return { ...mkInstance(), recurFreq: 'weekly', recurInterval: 1, recurUntil: null, ...over }
}

function TestProviders({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <LabelDirectoryContext.Provider value={fakeLabelDirectory()}>
        {children}
      </LabelDirectoryContext.Provider>
    </ThemeProvider>
  )
}

function renderEditor(initial: TaskDraft) {
  const onSave = vi.fn()
  const onDelete = vi.fn()
  const onClose = vi.fn()
  const { container } = render(
    <TestProviders>
      <TaskEditor
        initial={initial}
        isNew={false}
        onSave={onSave}
        onDelete={onDelete}
        onClose={onClose}
      />
    </TestProviders>,
  )
  return { onSave, onDelete, onClose, container }
}

test('assigns one existing Label or the first-class Unlabeled value', async () => {
  const user = userEvent.setup()
  const { onSave } = renderEditor(mkInstance({ recurParentId: null, labelId: null }))

  expect(screen.getByRole('button', { name: 'Unlabeled' })).toHaveAttribute('aria-pressed', 'true')
  await user.click(screen.getByRole('button', { name: 'Work' }))
  await user.click(screen.getByRole('button', { name: 'Save' }))
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ labelId: 'l1' }))
})

test('disables only Label assignment when the Board role lacks assignLabels', () => {
  render(
    <TestProviders>
      <TaskEditor
        initial={mkInstance({ recurParentId: null })}
        isNew={false}
        onSave={vi.fn()}
        onDelete={vi.fn()}
        onClose={vi.fn()}
        canAssignLabels={false}
      />
    </TestProviders>,
  )

  expect(screen.getByRole('button', { name: 'Unlabeled' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Work' })).toBeDisabled()
  expect(screen.getByPlaceholderText('Task title…')).toBeEnabled()
})

test('saving a pin-only change to a recurring instance skips the scope prompt', async () => {
  const user = userEvent.setup()
  const { onSave } = renderEditor(mkInstance({ pinned: false }))

  await user.click(screen.getByRole('button', { name: /Pin this note/ }))
  await user.click(screen.getByRole('button', { name: 'Save' }))

  expect(screen.queryByText('Save repeating task')).not.toBeInTheDocument()
  expect(onSave).toHaveBeenCalledTimes(1)
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ pinned: true }), 'this')
})

test('saving a status-only change to a recurring instance skips the scope prompt', async () => {
  const user = userEvent.setup()
  const { onSave } = renderEditor(mkInstance({ status: 'todo', done: false }))

  await user.click(screen.getByRole('button', { name: 'Completed' }))
  await user.click(screen.getByRole('button', { name: 'Save' }))

  expect(screen.queryByText('Save repeating task')).not.toBeInTheDocument()
  expect(onSave).toHaveBeenCalledTimes(1)
  expect(onSave).toHaveBeenCalledWith(
    expect.objectContaining({ status: 'done', done: true }),
    'this',
  )
})

test('saving a title change to a recurring instance still shows the scope prompt', async () => {
  const user = userEvent.setup()
  const { onSave } = renderEditor(mkInstance())

  await user.clear(screen.getByPlaceholderText('Task title…'))
  await user.type(screen.getByPlaceholderText('Task title…'), 'Water the ferns')
  await user.click(screen.getByRole('button', { name: 'Save' }))

  expect(screen.getByText('Save repeating task')).toBeInTheDocument()
  expect(onSave).not.toHaveBeenCalled()

  await user.click(screen.getByRole('button', { name: 'This and all future' }))
  expect(onSave).toHaveBeenCalledWith(
    expect.objectContaining({ title: 'Water the ferns' }),
    'future',
  )
})

test('saving a title change plus a pin change still shows the scope prompt', async () => {
  const user = userEvent.setup()
  const { onSave } = renderEditor(mkInstance({ pinned: false }))

  await user.click(screen.getByRole('button', { name: /Pin this note/ }))
  await user.clear(screen.getByPlaceholderText('Task title…'))
  await user.type(screen.getByPlaceholderText('Task title…'), 'Water the ferns')
  await user.click(screen.getByRole('button', { name: 'Save' }))

  expect(screen.getByText('Save repeating task')).toBeInTheDocument()
  expect(onSave).not.toHaveBeenCalled()

  await user.click(screen.getByRole('button', { name: 'This occurrence' }))
  expect(onSave).toHaveBeenCalledWith(
    expect.objectContaining({ title: 'Water the ferns', pinned: true }),
    'this',
  )
})

test('saving an atTime-only change to a recurring instance still shows the scope prompt', async () => {
  const user = userEvent.setup()
  const { onSave } = renderEditor(mkInstance({ atTime: null }))

  fireEvent.change(screen.getByLabelText('Due time'), { target: { value: '09:30' } })
  await user.click(screen.getByRole('button', { name: 'Save' }))

  expect(screen.getByText('Save repeating task')).toBeInTheDocument()
  expect(onSave).not.toHaveBeenCalled()

  await user.click(screen.getByRole('button', { name: 'This and all future' }))
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ atTime: '09:30' }), 'future')
})

// Until #213 this prompted, and this test asserted that it did — including clicking "This and all
// future", which the data layer then silently discarded, so the test pinned the bug's surface
// without catching the bug. The Scheduled Day is Occurrence Placement (ADR-0002): it means nothing
// beyond one Occurrence, so there is no scope to choose.
test('saving a day-only change to a recurring instance skips the scope prompt', async () => {
  const user = userEvent.setup()
  const { onSave, container } = renderEditor(mkInstance({ day: '2026-07-10' }))

  const dayInput = container.querySelector('input[type="date"]') as HTMLInputElement
  fireEvent.change(dayInput, { target: { value: '2026-07-17' } })
  await user.click(screen.getByRole('button', { name: 'Save' }))

  expect(screen.queryByText('Save repeating task')).not.toBeInTheDocument()
  expect(onSave).toHaveBeenCalledTimes(1)
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ day: '2026-07-17' }), 'this')
})

test('toggling the pin on a non-recurring task saves via the normal (no-prompt) path', async () => {
  const user = userEvent.setup()
  const { onSave } = renderEditor(mkInstance({ recurParentId: null, pinned: false }))

  await user.click(screen.getByRole('button', { name: /Pin this note/ }))
  await user.click(screen.getByRole('button', { name: 'Save' }))

  expect(screen.queryByText('Save repeating task')).not.toBeInTheDocument()
  expect(onSave).toHaveBeenCalledTimes(1)
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ pinned: true }))
})

// Narrow race: scopePrompt can only be opened via Save/Delete, which read-only already hides —
// but if the network drops while the prompt is already open on a recurring task, its "This
// occurrence" / "This and all future" buttons call onSave/onDelete directly and were ungated.
test('hides an open scope prompt if the board goes read-only mid-interaction', async () => {
  const user = userEvent.setup()
  const onSave = vi.fn()
  const { rerender } = render(
    <TestProviders>
      <TaskEditor
        initial={mkInstance()}
        isNew={false}
        onSave={onSave}
        onDelete={vi.fn()}
        onClose={vi.fn()}
      />
    </TestProviders>,
  )

  await user.clear(screen.getByPlaceholderText('Task title…'))
  await user.type(screen.getByPlaceholderText('Task title…'), 'Water the ferns')
  await user.click(screen.getByRole('button', { name: 'Save' }))
  expect(screen.getByText('Save repeating task')).toBeInTheDocument()

  rerender(
    <TestProviders>
      <TaskEditor
        initial={mkInstance()}
        isNew={false}
        onSave={onSave}
        onDelete={vi.fn()}
        onClose={vi.fn()}
        readOnly
      />
    </TestProviders>,
  )

  expect(screen.queryByText('Save repeating task')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'This and all future' })).not.toBeInTheDocument()
  expect(onSave).not.toHaveBeenCalled()
})

test('a scope prompt dismissed by read-only does not come back when the board recovers', async () => {
  // The old gate was `scopePrompt && !readOnly`, which HID the prompt without clearing it — so
  // reconnecting re-opened a prompt the user never re-triggered, mid-way through whatever they
  // were doing next. It is now cleared on the way in.
  const user = userEvent.setup()
  const onSave = vi.fn()
  const tree = (readOnly?: boolean) => (
    <TestProviders>
      <TaskEditor
        initial={mkInstance()}
        isNew={false}
        onSave={onSave}
        onDelete={vi.fn()}
        onClose={vi.fn()}
        readOnly={readOnly}
      />
    </TestProviders>
  )
  const { rerender } = render(tree())

  await user.clear(screen.getByPlaceholderText('Task title…'))
  await user.type(screen.getByPlaceholderText('Task title…'), 'Water the ferns')
  await user.click(screen.getByRole('button', { name: 'Save' }))
  expect(screen.getByText('Save repeating task')).toBeInTheDocument()

  rerender(tree(true))
  expect(screen.queryByText('Save repeating task')).not.toBeInTheDocument()

  rerender(tree(false))
  expect(screen.queryByText('Save repeating task')).not.toBeInTheDocument()
  expect(onSave).not.toHaveBeenCalled()
})

// #209: a Recurrence Rule with no Scheduled Day produces no Occurrence Dates, so saving one filed
// the task away as a template that materialized nothing and the card left the board with no error.
// The warning copy already existed; only the gate was missing.
//
// The Repeat select and the Day input carry no accessible name, so these reach them the way the
// day-scope tests above already do.
const repeatSelect = (c: HTMLElement) => c.querySelector('select') as HTMLSelectElement
const dayInput = (c: HTMLElement) => c.querySelector('input[type="date"]') as HTMLInputElement

test('refuses to save a recurrence rule on an unscheduled task', async () => {
  const user = userEvent.setup()
  const { onSave, container } = renderEditor(mkInstance({ recurParentId: null, day: 'inbox' }))

  fireEvent.change(repeatSelect(container), { target: { value: 'weekly' } })

  const save = screen.getByRole('button', { name: 'Save' })
  expect(save).toBeDisabled()
  await user.click(save)
  expect(onSave).not.toHaveBeenCalled()
  expect(screen.getByText(/repeats need a scheduled day/)).toBeInTheDocument()
})

test('re-enables save once the unscheduled repeating task is given a day', async () => {
  const user = userEvent.setup()
  const { onSave, container } = renderEditor(mkInstance({ recurParentId: null, day: 'inbox' }))

  fireEvent.change(repeatSelect(container), { target: { value: 'weekly' } })
  fireEvent.change(dayInput(container), { target: { value: '2026-07-10' } })

  const save = screen.getByRole('button', { name: 'Save' })
  expect(save).toBeEnabled()
  await user.click(save)
  expect(onSave).toHaveBeenCalledTimes(1)
})

test('an unscheduled task with no rule still saves', () => {
  // The gate is about the pair, not about the Inbox: an Inbox task on its own is perfectly savable.
  renderEditor(mkInstance({ recurParentId: null, day: 'inbox' }))
  expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
})

// #229 — in `save` mode "This and all future" reads as the safe, primary action, but since #220 it
// can end the Series and delete every later Occurrence. The card on screen survives either way, so
// the rows that disappear are the ones the user cannot see and there is no feedback afterwards.
// The copy is conditional on `removesRule`, the same predicate `resolveSave` routes on, so the
// warning cannot promise a removal the plan does not perform.
test('warns that later occurrences are removed when the repeat rule is cleared', async () => {
  const user = userEvent.setup()
  const { container } = renderEditor(editing())

  fireEvent.change(repeatSelect(container), { target: { value: 'none' } })
  await user.click(screen.getByRole('button', { name: 'Save' }))

  expect(screen.getByText(/later occurrences will be removed/i)).toBeInTheDocument()
})

test('keeps the neutral scope copy for an all-future edit that only writes', async () => {
  const user = userEvent.setup()
  const { container } = renderEditor(editing())

  await user.clear(screen.getByPlaceholderText('Task title…'))
  await user.type(screen.getByPlaceholderText('Task title…'), 'Water the ferns')
  await user.click(screen.getByRole('button', { name: 'Save' }))

  expect(screen.getByText('Save repeating task')).toBeInTheDocument()
  expect(screen.queryByText(/later occurrences will be removed/i)).not.toBeInTheDocument()
  // The Repeat control was never touched, so nothing about the Rule changed.
  expect(repeatSelect(container).value).toBe('weekly')
})

test('does not warn when the editor never had a rule to clear', async () => {
  // `Board.openTask` merges the Rule on only if it finds the definition. A draft that missed it
  // shows "Does not repeat" already, so there is nothing for the user to have removed — and
  // `removesRule` is false, matching the plan, which is an ordinary all-future edit.
  const user = userEvent.setup()
  renderEditor(mkInstance())

  await user.clear(screen.getByPlaceholderText('Task title…'))
  await user.type(screen.getByPlaceholderText('Task title…'), 'Water the ferns')
  await user.click(screen.getByRole('button', { name: 'Save' }))

  expect(screen.getByText('Save repeating task')).toBeInTheDocument()
  expect(screen.queryByText(/later occurrences will be removed/i)).not.toBeInTheDocument()
})
