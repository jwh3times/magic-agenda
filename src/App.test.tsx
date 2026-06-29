import { render, screen } from '@testing-library/react'
import App from './App'

// With no stored session, the protected board redirects to /login.
test('shows the login page when signed out', async () => {
  render(<App />)
  expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument()
  expect(screen.getByPlaceholderText('you@example.com')).toBeInTheDocument()
})
