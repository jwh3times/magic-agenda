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
  // Privacy's own body copy (the "Data retention" section) already links this same address, so a
  // single getByRole would throw on "multiple elements found" once the footer's identical link also
  // lands inside main — that ambiguity is expected, not a bug. Both must be in main: the body's own
  // link (via {children}) and the new contact-footer link.
  expect(within(main).getAllByRole('link', { name: 'jerryholland00@gmail.com' })).toHaveLength(2)
})
