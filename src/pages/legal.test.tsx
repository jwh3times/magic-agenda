import { render, screen, within } from '@testing-library/react'
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

test('the legal shell wraps its content in banner and main landmarks', () => {
  render(<Privacy />)
  expect(screen.getByRole('banner')).toBeInTheDocument()
  const main = screen.getByRole('main')
  // The heading and the "last updated" line must be INSIDE main. Wrapping only {children} would
  // leave them, the logo link and the contact block outside every landmark — and no test in this
  // repo scans /privacy, so nothing else would report it.
  expect(
    within(main).getByRole('heading', { level: 1, name: /privacy policy/i }),
  ).toBeInTheDocument()
  expect(within(main).getByText(/Last updated:/)).toBeInTheDocument()
  // Scoped to text the shell itself owns (not Privacy.tsx's body copy, which happens to link the
  // same address), so this can't be broken by an unrelated edit to the page body — only by the
  // contact block being removed or moved outside main.
  expect(within(main).getByText(/Questions about this policy/)).toBeInTheDocument()
})
