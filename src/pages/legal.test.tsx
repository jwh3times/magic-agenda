import { render, screen } from '@testing-library/react'
import { Privacy } from './Privacy'
import { Terms } from './Terms'

test('privacy policy renders its heading', () => {
  render(<Privacy />)
  expect(screen.getByRole('heading', { level: 1, name: /privacy policy/i })).toBeInTheDocument()
})

test('terms of service renders its heading', () => {
  render(<Terms />)
  expect(screen.getByRole('heading', { level: 1, name: /terms of service/i })).toBeInTheDocument()
})
