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
