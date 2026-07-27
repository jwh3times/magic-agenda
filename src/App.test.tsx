import { render, screen } from '@testing-library/react'
import { afterEach } from 'vitest'
import App from './App'

// `/` used to redirect signed-out visitors to /login. It no longer does — that login wall is
// exactly why Google's OAuth branding verification failed (the home page did not explain the
// product), so signed-out `/` renders the landing page. Routing for all three session states is
// pinned in HomeRoute.test.tsx; this asserts the wiring end to end with the real AuthProvider and
// no stored session.

afterEach(() => window.history.pushState({}, '', '/'))

test('signed out, the home page is the landing page rather than a login wall', async () => {
  render(<App />)
  expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(
    'Your week, on sticky notes.',
  )
  expect(screen.getByRole('link', { name: 'Get started' })).toHaveAttribute('href', '/login')
})

test('the login form is still reachable at /login', async () => {
  window.history.pushState({}, '', '/login')
  render(<App />)
  expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument()
  expect(screen.getByPlaceholderText('you@example.com')).toBeInTheDocument()
})
