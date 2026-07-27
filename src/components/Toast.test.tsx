import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { Toast } from './Toast'

test('shows the message and dismisses on click', async () => {
  const user = userEvent.setup()
  const onDismiss = vi.fn()
  render(<Toast message="row-level security violation" onDismiss={onDismiss} />)

  expect(screen.getByRole('alert')).toHaveTextContent('row-level security violation')
  await user.click(screen.getByRole('button', { name: 'Dismiss' }))
  expect(onDismiss).toHaveBeenCalledTimes(1)
})

test('error tone keeps the sync prefix', () => {
  render(<Toast message="boom" onDismiss={() => {}} />)
  expect(screen.getByRole('alert')).toHaveTextContent('Couldn’t sync. boom')
})

test('info tone drops the prefix and can carry an action', async () => {
  const user = userEvent.setup()
  const onClick = vi.fn()
  render(
    <Toast
      message="New version available."
      tone="info"
      action={{ label: 'Refresh', onClick }}
      onDismiss={() => {}}
    />,
  )
  expect(screen.getByRole('status')).not.toHaveTextContent('sync')
  await user.click(screen.getByRole('button', { name: 'Refresh' }))
  expect(onClick).toHaveBeenCalledOnce()
})
