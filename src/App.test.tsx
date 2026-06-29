import { render, screen } from '@testing-library/react'
import App from './App'

test('renders the app name', () => {
  render(<App />)
  expect(screen.getByText(/Magic Agenda/)).toBeInTheDocument()
})

test('renders mock task cards', () => {
  render(<App />)
  expect(screen.getByText('Finish Q3 deck')).toBeInTheDocument()
  expect(screen.getByText('Renew passport')).toBeInTheDocument()
})
