import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { ThemeProvider } from '../theme/ThemeProvider'
import { TaskEditor } from './TaskEditor'
import { NO_RECUR, type Task } from '../types/task'

function mkInstance(over: Partial<Task> = {}): Task {
  return {
    id: 'inst-1',
    title: 'Water the plants',
    description: '',
    category: 'work',
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
    recurParentId: 'template-1', // a materialized instance of a recurring series
    ...over,
  }
}

function renderEditor(initial: Task) {
  const onSave = vi.fn()
  const onDelete = vi.fn()
  const onClose = vi.fn()
  render(
    <ThemeProvider>
      <TaskEditor
        initial={initial}
        isNew={false}
        onSave={onSave}
        onDelete={onDelete}
        onClose={onClose}
      />
    </ThemeProvider>,
  )
  return { onSave, onDelete, onClose }
}

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
