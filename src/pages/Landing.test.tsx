import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, test } from 'vitest'
import { Landing } from './Landing'

function renderLanding() {
  return render(
    <MemoryRouter>
      <Landing />
    </MemoryRouter>,
  )
}

const PREVIEW = '[aria-hidden="true"][inert]'

/** The preview is lazy (it carries ~27 kB of card/theme code), so it arrives after first paint. */
async function findPreview(container: HTMLElement): Promise<HTMLElement> {
  await waitFor(() => expect(container.querySelector(PREVIEW)).not.toBeNull())
  return container.querySelector(PREVIEW) as HTMLElement
}

afterEach(() => {
  document.title = ''
})

test('explains what the product is and how to start — the two things the Google review checks', () => {
  renderLanding()
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Your week, on sticky notes.')
  expect(screen.getByText(/drag-and-drop task board/i)).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Get started' })).toHaveAttribute('href', '/login')
  expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login')
})

// Google's branding verification rejected the site because "the app name configured for your OAuth
// consent screen does not match the app name on your home page". The name was only ever an <img>
// alt attribute and a footer copyright line — the logo's wordmark lives inside an SVG the DOM never
// sees, and renders lowercase. This pins the exact configured name as visible page text.
test('shows the OAuth app name "Magic Agenda" as real text, not only as image alt text', () => {
  const { container } = renderLanding()
  const header = container.querySelector('header') as HTMLElement
  expect(within(header).getByText('Magic Agenda')).toBeInTheDocument()
  // ...and the purpose sentence names the app, so name and purpose are tied together on the page.
  expect(screen.getByText(/^Magic Agenda is a drag-and-drop task board/)).toBeInTheDocument()
})

test('links the legal pages', () => {
  renderLanding()
  expect(screen.getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '/privacy')
  expect(screen.getByRole('link', { name: 'Terms' })).toHaveAttribute('href', '/terms')
})

test('sets a descriptive document title and restores it on unmount', () => {
  document.title = 'Magic Agenda'
  const { unmount } = renderLanding()
  expect(document.title).toMatch(/sticky-note task board/i)
  unmount()
  expect(document.title).toBe('Magic Agenda')
})

// The preview is decoration. If it ever becomes focusable, a keyboard user tabbing the page walks
// into fake task cards that do nothing — so this is pinned rather than left to the markup.
test('the board preview is hidden from assistive tech and holds nothing focusable', async () => {
  const { container } = renderLanding()
  const preview = await findPreview(container)
  expect(preview.querySelectorAll('button, a, input, [tabindex]')).toHaveLength(0)
})

test('the theme toggle restyles the preview without touching stored settings', async () => {
  const user = userEvent.setup()
  const { container } = renderLanding()
  await findPreview(container)
  const markup = () => (container.querySelector(PREVIEW) as HTMLElement).innerHTML

  const corkMarkup = markup()
  expect(screen.getByRole('button', { name: 'Cork' })).toHaveAttribute('aria-pressed', 'true')

  await user.click(screen.getByRole('button', { name: 'Neon-Brutalist' }))

  expect(screen.getByRole('button', { name: 'Neon-Brutalist' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  expect(screen.getByRole('button', { name: 'Cork' })).toHaveAttribute('aria-pressed', 'false')
  expect(markup()).not.toBe(corkMarkup)
})

test('renders real task cards from the mock board, not placeholder text', async () => {
  const { container } = renderLanding()
  const preview = within(await findPreview(container))
  // makeMockTasks() seeds these; if the preview silently renders empty cells this fails.
  expect(preview.getAllByText(/\S/).length).toBeGreaterThan(3)
})

// Deliberately not tested here: "the hero paints before the preview". React.lazy caches its
// resolved value on the lazy object, so once any earlier test has rendered the preview, later
// renders resolve synchronously — the assertion would pass or fail based on test order, not on
// behaviour. That the preview is a separate chunk is a build property, visible in the build output
// (BoardPreview / TaskCard / chunk sizes) rather than in jsdom.

// An unnamed <section> is not a landmark, so everything inside it fails axe's `region` rule. The two
// names must DIFFER — identical role+name pairs would fail `landmark-unique` instead.
test('both content sections are named landmarks', () => {
  renderLanding()
  expect(screen.getByRole('region', { name: 'Live board preview' })).toBeInTheDocument()
  expect(screen.getByRole('region', { name: 'Features' })).toBeInTheDocument()
})
