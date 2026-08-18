import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState, type ReactNode } from 'react'
import { afterEach, expect, test, vi } from 'vitest'
import { fakeBoardSession, fakeBoardSummary } from '../board/fakeBoardDirectory'
import type { BoardRole } from '../board/role'
import { fakeLabel, fakeLabelDirectory } from '../labels/fakeLabelDirectory'
import { LabelDirectoryContext } from '../labels/labelDirectoryContext'
import { checkColor, checkName, moveLabel, nextPosition } from '../labels/labelIntent'
import type { UseLabels } from '../labels/useLabels'
import { ThemeProvider } from '../theme/ThemeProvider'
import type { Label } from '../types/label'

const h = vi.hoisted(() => ({ role: 'owner' as BoardRole }))

vi.mock('../board/BoardDirectoryProvider', () => ({
  useBoardSession: () => fakeBoardSession(fakeBoardSummary({ role: h.role })),
}))

import { LabelsSection } from './LabelsSection'

const VOCABULARY = [
  fakeLabel({ id: 'a', name: 'Work', dotColor: '#2563eb', position: 0 }),
  fakeLabel({ id: 'b', name: 'Personal', dotColor: '#db2777', position: 1 }),
  fakeLabel({ id: 'c', name: 'Errands', dotColor: '#d97706', position: 2 }),
]

/**
 * A Label Directory backed by real React state, so a write actually re-renders the section.
 *
 * Same precedent as `Board.test.tsx`'s in-memory `TaskBoard`: the component is exercised against
 * its real interface with the Supabase adapter swapped out, rather than against a stub shaped like
 * whichever methods this test happens to call. The decisions come from `labelIntent` so the
 * harness cannot accidentally accept a name the real hook would refuse.
 */
function Harness({
  initial = VOCABULARY,
  overrides = {},
}: {
  initial?: Label[]
  overrides?: Partial<UseLabels>
}) {
  const [labels, setLabels] = useState(initial)
  const [sequence, setSequence] = useState(0)

  const directory: UseLabels = {
    ...fakeLabelDirectory({ labels }),
    createLabel: (name, dotColor) => {
      const problem = checkName(name, labels) ?? checkColor(dotColor)
      if (problem) return Promise.resolve(problem)
      setSequence((n) => n + 1)
      setLabels((current) => [
        ...current,
        {
          id: `new-${sequence + 1}`,
          boardId: 'b1',
          name: name.trim(),
          dotColor,
          position: nextPosition(current),
        },
      ])
      return Promise.resolve(null)
    },
    renameLabel: (id, name) => {
      const problem = checkName(name, labels, id)
      if (problem) return Promise.resolve(problem)
      setLabels((current) => current.map((l) => (l.id === id ? { ...l, name: name.trim() } : l)))
      return Promise.resolve(null)
    },
    recolorLabel: (id, dotColor) => {
      const problem = checkColor(dotColor)
      if (problem) return Promise.resolve(problem)
      setLabels((current) => current.map((l) => (l.id === id ? { ...l, dotColor } : l)))
      return Promise.resolve(null)
    },
    reorderLabel: (id, delta) => {
      setLabels((current) => moveLabel(current, id, delta) ?? current)
      return Promise.resolve(null)
    },
    deleteLabel: (id) => {
      setLabels((current) =>
        current.filter((l) => l.id !== id).map((l, index) => ({ ...l, position: index })),
      )
      return Promise.resolve(null)
    },
    ...overrides,
  }

  return <Wrap directory={directory} />
}

function Wrap({ directory }: { directory: UseLabels }): ReactNode {
  return (
    <ThemeProvider initial="cork">
      <LabelDirectoryContext.Provider value={directory}>
        <LabelsSection />
      </LabelDirectoryContext.Provider>
    </ThemeProvider>
  )
}

const renderStatic = (overrides: Partial<UseLabels>) =>
  render(<Wrap directory={fakeLabelDirectory(overrides)} />)

/**
 * The *committed* names, in render order.
 *
 * Deliberately not the text inputs' values: a refused rename keeps the user's draft in the box so
 * they can correct it, so reading those would assert on what was typed rather than on what was
 * saved. Each row's colour swatch is labelled from the committed name, and the new-label control
 * lives outside the list, so the rows alone are the vocabulary.
 */
const names = () =>
  screen.getAllByRole('listitem').map((row) =>
    (
      within(row)
        .getByLabelText(/^Colour for /)
        .getAttribute('aria-label') ?? ''
    ).replace('Colour for ', ''),
  )

// Restore the default role between tests, so ordering cannot leak a Viewer into a later
// Owner assertion.
afterEach(() => {
  h.role = 'owner'
})

test('an Owner sees the vocabulary in position order', () => {
  render(<Harness />)
  expect(names()).toEqual(['Work', 'Personal', 'Errands'])
})

test('an Owner can add a label, and it appends to the end', async () => {
  const user = userEvent.setup()
  render(<Harness />)

  await user.type(screen.getByLabelText('New label'), 'Deep work')
  await user.click(screen.getByRole('button', { name: 'Add label' }))

  await waitFor(() => expect(names()).toEqual(['Work', 'Personal', 'Errands', 'Deep work']))
  // The draft clears so the next add does not start from the previous name.
  expect(screen.getByLabelText('New label')).toHaveValue('')
})

test('a duplicate name is explained and nothing is added', async () => {
  const user = userEvent.setup()
  render(<Harness />)

  await user.type(screen.getByLabelText('New label'), '  work  ')
  await user.click(screen.getByRole('button', { name: 'Add label' }))

  expect(await screen.findByRole('alert')).toHaveTextContent('Work')
  expect(names()).toEqual(['Work', 'Personal', 'Errands'])
})

test('the add button stays disabled until the draft has a usable name', async () => {
  const user = userEvent.setup()
  render(<Harness />)

  const add = screen.getByRole('button', { name: 'Add label' })
  expect(add).toBeDisabled()

  await user.type(screen.getByLabelText('New label'), '   ')
  expect(add).toBeDisabled()

  await user.type(screen.getByLabelText('New label'), 'Chores')
  expect(add).toBeEnabled()
})

test('renaming commits on blur', async () => {
  const user = userEvent.setup()
  render(<Harness />)

  const input = screen.getByLabelText('Name for Work')
  await user.clear(input)
  await user.type(input, 'Focus')
  await user.tab()

  await waitFor(() => expect(names()).toEqual(['Focus', 'Personal', 'Errands']))
})

test('Escape abandons a rename without writing', async () => {
  const user = userEvent.setup()
  render(<Harness />)

  const input = screen.getByLabelText('Name for Work')
  await user.clear(input)
  await user.type(input, 'Discarded{Escape}')
  await user.tab()

  await waitFor(() => expect(names()).toEqual(['Work', 'Personal', 'Errands']))
})

test('renaming to a sibling name is refused and the vocabulary is unchanged', async () => {
  const user = userEvent.setup()
  render(<Harness />)

  const input = screen.getByLabelText('Name for Work')
  await user.clear(input)
  await user.type(input, 'Personal')
  await user.tab()

  expect(await screen.findByRole('alert')).toHaveTextContent('Personal')
  expect(names()).toEqual(['Work', 'Personal', 'Errands'])
})

test('reordering moves one place and the end arrows are inert', async () => {
  const user = userEvent.setup()
  render(<Harness />)

  expect(screen.getByRole('button', { name: 'Move Work up' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Move Errands down' })).toBeDisabled()

  await user.click(screen.getByRole('button', { name: 'Move Work down' }))
  await waitFor(() => expect(names()).toEqual(['Personal', 'Work', 'Errands']))
})

test('deleting asks first, states the consequence, and can be cancelled', async () => {
  const user = userEvent.setup()
  render(<Harness />)

  await user.click(screen.getByRole('button', { name: 'Delete Work' }))
  expect(screen.getByText(/become Unlabeled/i)).toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(screen.queryByText(/become Unlabeled/i)).not.toBeInTheDocument()
  expect(names()).toEqual(['Work', 'Personal', 'Errands'])
})

test('confirming a delete removes the label and renumbers the rest', async () => {
  const user = userEvent.setup()
  render(<Harness />)

  await user.click(screen.getByRole('button', { name: 'Delete Work' }))
  await user.click(screen.getByRole('button', { name: 'Delete label' }))

  await waitFor(() => expect(names()).toEqual(['Personal', 'Errands']))
  // Renumbering means the new first row's up arrow is the disabled one.
  expect(screen.getByRole('button', { name: 'Move Personal up' })).toBeDisabled()
})

test('deleting the last label leaves an empty state rather than a blank section', async () => {
  const user = userEvent.setup()
  render(<Harness initial={[fakeLabel({ id: 'only', name: 'Work' })]} />)

  await user.click(screen.getByRole('button', { name: 'Delete Work' }))
  await user.click(screen.getByRole('button', { name: 'Delete label' }))

  expect(await screen.findByText(/No labels yet/i)).toBeInTheDocument()
  // The Owner can still recover from it.
  expect(screen.getByLabelText('New label')).toBeInTheDocument()
})

test('a seeded label is managed exactly like a user-created one', async () => {
  const user = userEvent.setup()
  // 'Work' is one of the five seeded definitions; nothing marks it as special in the app domain.
  render(<Harness />)

  const input = screen.getByLabelText('Name for Work')
  await user.clear(input)
  await user.type(input, 'Renamed seed')
  await user.tab()

  await waitFor(() => expect(names()).toContain('Renamed seed'))
  expect(screen.getByRole('button', { name: 'Delete Renamed seed' })).toBeEnabled()
})

test('an Editor sees the vocabulary but no management controls', () => {
  h.role = 'editor'
  render(<Harness />)
  expect(screen.getByText('Work')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /^Delete/ })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Add label' })).not.toBeInTheDocument()
  expect(screen.queryByLabelText('Name for Work')).not.toBeInTheDocument()
  expect(screen.getByText(/Only the board owner can/i)).toBeInTheDocument()
})

test('a Viewer is equally read-only', () => {
  h.role = 'viewer'
  render(<Harness />)
  expect(screen.queryByRole('button', { name: 'Add label' })).not.toBeInTheDocument()
  expect(screen.getByText(/Only the board owner can/i)).toBeInTheDocument()
})

test('the loading state does not render an empty vocabulary', () => {
  renderStatic({ labels: [], loading: true })
  expect(screen.getByText(/Loading labels/i)).toBeInTheDocument()
  expect(screen.queryByText(/No labels yet/i)).not.toBeInTheDocument()
})

test('a load failure explains itself and offers a retry', async () => {
  const user = userEvent.setup()
  const reload = vi.fn(() => Promise.resolve())
  renderStatic({ labels: [], error: 'network down', reload })

  expect(screen.getByRole('alert')).toHaveTextContent('network down')
  await user.click(screen.getByRole('button', { name: 'Try again' }))
  expect(reload).toHaveBeenCalledOnce()
})

test('an offline snapshot is shown read-only rather than accepting writes it cannot send', () => {
  renderStatic({ labels: VOCABULARY, offline: true })

  expect(screen.getByRole('status')).toHaveTextContent(/last saved labels/i)
  expect(screen.getByRole('button', { name: 'Add label' })).toBeDisabled()
  expect(screen.getByLabelText('New label')).toBeDisabled()
  expect(screen.queryByRole('button', { name: 'Delete Work' })).not.toBeInTheDocument()
})

test('the empty state is distinguishable from the loading state', () => {
  renderStatic({ labels: [] })
  const empty = screen.getByText(/No labels yet/i)
  expect(within(empty).queryByText(/Loading/i)).not.toBeInTheDocument()
  expect(screen.getByLabelText('New label')).toBeEnabled()
})
