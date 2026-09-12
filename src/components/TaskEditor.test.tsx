import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { ThemeProvider } from '../theme/ThemeProvider'
import { TaskEditor } from './TaskEditor'
import { asTask, NO_RECUR, type Task, type TaskDraft } from '../types/task'
import type { ReactNode } from 'react'
import { LabelDirectoryContext } from '../labels/labelDirectoryContext'
import { fakeLabelDirectory } from '../labels/fakeLabelDirectory'
import type { RecurScope } from '../data/series'

function mkInstance(over: Partial<TaskDraft> = {}): Task {
  return asTask({
    id: 'inst-1',
    title: 'Water the plants',
    description: '',
    labelId: null,
    color: 'yellow',
    checklist: [],
    status: 'todo',
    completedAt: null,
    reopenStatus: 'todo',
    archivedAt: null,
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
  const onSave = vi.fn<(task: TaskDraft, scope?: RecurScope) => void>()
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
  const { onSave } = renderEditor(mkInstance({ status: 'todo' }))

  await user.click(screen.getByRole('button', { name: 'Completed' }))
  await user.click(screen.getByRole('button', { name: 'Save' }))

  expect(screen.queryByText('Save repeating task')).not.toBeInTheDocument()
  expect(onSave).toHaveBeenCalledTimes(1)
  const [saved, scope] = onSave.mock.calls[0]
  expect(saved).toMatchObject({ status: 'completed', reopenStatus: 'todo' })
  expect(typeof saved.completedAt).toBe('string')
  expect(scope).toBe('this')
})

test('all Checklist Steps may be complete while Workflow Status remains To Do', async () => {
  const user = userEvent.setup()
  const { onSave } = renderEditor(
    mkInstance({ checklist: [{ id: 'c1', text: 'Only step', done: true }], status: 'todo' }),
  )

  await user.click(screen.getByRole('button', { name: 'Save' }))

  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ status: 'todo' }), 'this')
})

test('rescheduling a Completed Task preserves Completed At', async () => {
  const user = userEvent.setup()
  const { onSave, container } = renderEditor(
    mkInstance({
      status: 'completed',
      completedAt: '2026-09-01T12:00:00.000Z',
      reopenStatus: 'doing',
    }),
  )
  const day = container.querySelector('input[type="date"]') as HTMLInputElement
  fireEvent.change(day, { target: { value: '2026-07-11' } })

  await user.click(screen.getByRole('button', { name: 'Save' }))

  expect(onSave).toHaveBeenCalledWith(
    expect.objectContaining({
      status: 'completed',
      completedAt: '2026-09-01T12:00:00.000Z',
      day: '2026-07-11',
    }),
    'this',
  )
})

test('ending an edit on the original Completed status preserves its lifecycle state', async () => {
  const user = userEvent.setup()
  const { onSave } = renderEditor(
    mkInstance({
      status: 'completed',
      completedAt: '2026-09-01T12:00:00.000Z',
      reopenStatus: 'doing',
      archivedAt: '2026-09-02T12:00:00.000Z',
    }),
  )

  await user.click(screen.getByRole('button', { name: 'To Do' }))
  await user.click(screen.getByRole('button', { name: 'Completed' }))
  await user.click(screen.getByRole('button', { name: 'Save' }))

  expect(onSave).toHaveBeenCalledWith(
    expect.objectContaining({
      status: 'completed',
      completedAt: '2026-09-01T12:00:00.000Z',
      reopenStatus: 'doing',
      archivedAt: '2026-09-02T12:00:00.000Z',
    }),
    'this',
  )
})

test('explicitly Reopening a Completed Task clears Completed At and Archive', async () => {
  const user = userEvent.setup()
  const { onSave } = renderEditor(
    mkInstance({
      status: 'completed',
      completedAt: '2026-09-01T12:00:00.000Z',
      reopenStatus: 'doing',
      archivedAt: '2026-09-02T12:00:00.000Z',
    }),
  )

  await user.click(screen.getByRole('button', { name: 'To Do' }))
  await user.click(screen.getByRole('button', { name: 'Save' }))

  expect(onSave).toHaveBeenCalledWith(
    expect.objectContaining({
      status: 'todo',
      completedAt: null,
      reopenStatus: 'todo',
      archivedAt: null,
    }),
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

test('oversized cached content explains the limit and can be repaired before saving', () => {
  renderEditor(mkInstance({ recurParentId: null, title: 'x'.repeat(501) }))
  expect(screen.getByRole('alert')).toHaveTextContent('500 characters')
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  const title = screen.getByPlaceholderText('Task title…')
  expect(title).toHaveAttribute('maxlength', '1000')
  expect(screen.getByPlaceholderText('Add a short description…')).toHaveAttribute(
    'maxlength',
    '40000',
  )
  fireEvent.change(title, { target: { value: 'Repaired' } })
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
})

test('a full checklist prevents additions and removal enables them again', () => {
  renderEditor(
    mkInstance({
      checklist: Array.from({ length: 200 }, (_, i) => ({
        id: String(i),
        text: 'Item',
        done: false,
      })),
    }),
  )
  expect(screen.getByPlaceholderText('Checklist limit reached (200 items)')).toBeDisabled()
  fireEvent.click(screen.getAllByRole('button', { name: 'Remove item' })[0])
  expect(screen.getByPlaceholderText('Add a subtask and press Enter…')).toBeEnabled()
})

test('an out-of-range cached interval remains repairable even with repetition off', () => {
  renderEditor({ ...mkInstance({ recurParentId: null }), recurInterval: 367 })
  expect(screen.getByRole('alert')).toHaveTextContent('1 to 366')
  const interval = screen.getByRole('spinbutton')
  expect(interval).toHaveAttribute('max', '366')
  fireEvent.change(interval, { target: { value: '366' } })
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
})

test('editor character limits allow full emoji titles and trim pasted excess by code point', () => {
  const { onSave } = renderEditor(mkInstance({ recurParentId: null }))
  const title = screen.getByPlaceholderText('Task title…')
  fireEvent.change(title, { target: { value: '🎉'.repeat(501) } })
  expect(title).toHaveValue('🎉'.repeat(500))
  const description = screen.getByPlaceholderText('Add a short description…')
  fireEvent.change(description, { target: { value: '🎉'.repeat(20001) } })
  expect(description).toHaveValue('🎉'.repeat(20000))
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(onSave).toHaveBeenCalledWith(
    expect.objectContaining({ title: '🎉'.repeat(500), description: '🎉'.repeat(20000) }),
  )
})

/** A standalone Task, so a Rule change saves directly instead of raising the scope prompt. */
function standalone(over: Partial<TaskDraft> = {}): TaskDraft {
  return { ...mkInstance({ recurParentId: null, occurrenceDate: null }), ...over }
}

// The fixture day, 2026-07-10, is a Friday — so Friday is the anchor weekday throughout.
test('weekday chips appear only for a weekly Rule', async () => {
  const user = userEvent.setup()
  renderEditor(standalone({ recurFreq: 'weekly' }))
  expect(screen.getByRole('group', { name: 'Repeat on' })).toBeInTheDocument()

  await user.selectOptions(screen.getByRole('combobox', { name: '' }), 'monthly')
  expect(screen.queryByRole('group', { name: 'Repeat on' })).not.toBeInTheDocument()
})

test("the anchor's own weekday is shown on and cannot be switched off", async () => {
  const user = userEvent.setup()
  const { onSave } = renderEditor(standalone({ recurFreq: 'weekly' }))

  const friday = screen.getByRole('button', { name: /^Friday/ })
  expect(friday).toHaveAttribute('aria-pressed', 'true')
  expect(friday).toBeDisabled()

  await user.click(friday)
  await user.click(screen.getByRole('button', { name: 'Save' }))
  // Still empty, not [5]: an empty set already means "the anchor's weekday", and storing it would
  // make the Rule's meaning depend on which day it happened to be created on.
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ recurWeekdays: [] }))
})

test('ticking other weekdays saves them in a stable order', async () => {
  const user = userEvent.setup()
  const { onSave } = renderEditor(standalone({ recurFreq: 'weekly' }))

  await user.click(screen.getByRole('button', { name: 'Wednesday' }))
  await user.click(screen.getByRole('button', { name: 'Monday' }))
  await user.click(screen.getByRole('button', { name: 'Save' }))

  // Sorted, not click-ordered: changedTaskKeys compares arrays by content, so an unstable order
  // would make re-ticking the same days look like an edit.
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ recurWeekdays: [1, 3] }))
})

test('a weekday can be unticked again', async () => {
  const user = userEvent.setup()
  const { onSave } = renderEditor(standalone({ recurFreq: 'weekly', recurWeekdays: [1, 3] }))

  await user.click(screen.getByRole('button', { name: 'Monday' }))
  await user.click(screen.getByRole('button', { name: 'Save' }))
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ recurWeekdays: [3] }))
})

test('changing away from weekly clears the weekday set rather than carrying it', async () => {
  const user = userEvent.setup()
  const { onSave } = renderEditor(standalone({ recurFreq: 'weekly', recurWeekdays: [1, 3] }))

  await user.selectOptions(screen.getByRole('combobox', { name: '' }), 'daily')
  await user.click(screen.getByRole('button', { name: 'Save' }))
  // tasks_recur_weekdays_weekly_only refuses the row otherwise: this is a save that fails, not a
  // field that is quietly ignored.
  expect(onSave).toHaveBeenCalledWith(
    expect.objectContaining({ recurFreq: 'daily', recurWeekdays: [] }),
  )
})

test('the two ways a Rule can end are offered as a choice, never both at once', async () => {
  const user = userEvent.setup()
  const { onSave } = renderEditor(standalone({ recurFreq: 'weekly', recurUntil: '2026-12-31' }))

  expect(screen.getByRole('radio', { name: 'On' })).toBeChecked()
  expect(screen.getByLabelText('Number of repeats')).toBeDisabled()

  await user.click(screen.getByRole('radio', { name: 'After' }))
  expect(screen.getByLabelText('Repeat until')).toBeDisabled()

  await user.click(screen.getByRole('button', { name: 'Save' }))
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ recurCount: 10, recurUntil: null }))
})

test('choosing an end date clears a count that was already set', async () => {
  const user = userEvent.setup()
  const { onSave } = renderEditor(standalone({ recurFreq: 'weekly', recurCount: 12 }))

  expect(screen.getByRole('radio', { name: 'After' })).toBeChecked()
  await user.click(screen.getByRole('radio', { name: 'On' }))
  fireEvent.change(screen.getByLabelText('Repeat until'), { target: { value: '2026-12-31' } })
  await user.click(screen.getByRole('button', { name: 'Save' }))

  expect(onSave).toHaveBeenCalledWith(
    expect.objectContaining({ recurCount: null, recurUntil: '2026-12-31' }),
  )
})

test('switching to an end date clears the count even before a date is chosen', async () => {
  const user = userEvent.setup()
  const { onSave } = renderEditor(standalone({ recurFreq: 'weekly', recurCount: 12 }))

  await user.click(screen.getByRole('radio', { name: 'On' }))
  await user.click(screen.getByRole('button', { name: 'Save' }))
  // Without this the radio would say On while the saved Rule still ended after 12 repeats. The
  // date field clears the count too, but only once it is touched -- a user who picks On and stops
  // there would otherwise save a Rule that disagrees with the control they last used.
  expect(onSave).toHaveBeenCalledWith(
    expect.objectContaining({ recurCount: null, recurUntil: null }),
  )
})
test('Never clears both ends', async () => {
  const user = userEvent.setup()
  const { onSave } = renderEditor(
    standalone({ recurFreq: 'weekly', recurCount: 12, recurUntil: '2026-12-31' }),
  )

  await user.click(screen.getByRole('radio', { name: 'Never' }))
  await user.click(screen.getByRole('button', { name: 'Save' }))
  expect(onSave).toHaveBeenCalledWith(
    expect.objectContaining({ recurCount: null, recurUntil: null }),
  )
})

test('a count past the ceiling cannot be entered, so Save is never blocked by one', async () => {
  const user = userEvent.setup()
  const { onSave } = renderEditor(standalone({ recurFreq: 'weekly', recurCount: 5 }))

  fireEvent.change(screen.getByLabelText('Number of repeats'), { target: { value: '99999' } })
  await user.click(screen.getByRole('button', { name: 'Save' }))
  // Clamped to MAX_OCCURRENCES on the way in, matching how the interval field already behaves --
  // taskLimitError is the backstop for drafts that never went through this control.
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ recurCount: 1000 }))
})

test('editing an Occurrence Rule still asks about scope before saving', async () => {
  const user = userEvent.setup()
  const { onSave } = renderEditor(editing())

  await user.click(screen.getByRole('button', { name: 'Wednesday' }))
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await user.click(screen.getByRole('button', { name: 'This and all future' }))

  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ recurWeekdays: [3] }), 'future')
})

test('the new Repeat controls are inert when the board is read-only', () => {
  render(
    <TestProviders>
      <TaskEditor
        initial={standalone({ recurFreq: 'weekly', recurCount: 5 })}
        isNew={false}
        onSave={vi.fn()}
        onDelete={vi.fn()}
        onClose={vi.fn()}
        readOnly
      />
    </TestProviders>,
  )
  expect(screen.getByRole('button', { name: 'Monday' })).toBeDisabled()
  expect(screen.getByRole('radio', { name: 'Never' })).toBeDisabled()
  expect(screen.getByLabelText('Number of repeats')).toBeDisabled()
})
