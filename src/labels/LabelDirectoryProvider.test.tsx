import { render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({ useLabels: vi.fn() }))

vi.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }))
vi.mock('../board/BoardDirectoryProvider', () => ({
  useBoardSession: () => ({ board: { id: 'b1' }, can: {} }),
}))
vi.mock('./useLabels', () => ({ useLabels: h.useLabels }))

import {
  LabelDirectoryProvider,
  useLabel,
  useLabelDirectoryContext,
} from './LabelDirectoryProvider'
import { fakeLabelDirectory } from './fakeLabelDirectory'

function Probe() {
  const { labels } = useLabelDirectoryContext()
  const selected = useLabel('l1')
  return <div>{`${labels.length}:${selected?.name}`}</div>
}

test('loads labels for the session’s selected Board and resolves them by id', () => {
  h.useLabels.mockReturnValue(fakeLabelDirectory())
  render(
    <LabelDirectoryProvider>
      <Probe />
    </LabelDirectoryProvider>,
  )

  expect(h.useLabels).toHaveBeenCalledWith('u1', 'b1', true)
  expect(screen.getByText('1:Work')).toBeInTheDocument()
})

test('the Label hooks fail clearly outside their provider', () => {
  expect(() => render(<Probe />)).toThrow(
    'useLabelDirectoryContext must be used within <LabelDirectoryProvider>',
  )
})
