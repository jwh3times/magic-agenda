import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'
import { fakeBoardSummary } from '../board/fakeBoardDirectory'
import type { BoardOutcome } from '../board/outcome'
import { CalendarFeedPanel } from './CalendarFeedPanel'

const readCalendarFeedToken = vi.fn<(boardId: string) => Promise<BoardOutcome<string>>>()
const rotateCalendarFeedToken = vi.fn<(boardId: string) => Promise<BoardOutcome<string>>>()

vi.mock('../board/calendarFeed', async (importActual) => ({
  ...(await importActual<typeof import('../board/calendarFeed')>()),
  readCalendarFeedToken: (id: string) => readCalendarFeedToken(id),
  rotateCalendarFeedToken: (id: string) => rotateCalendarFeedToken(id),
}))

const BOARD = fakeBoardSummary({ id: 'b1', name: 'Personal', role: 'viewer' })
const OLD = '11111111-1111-4111-8111-111111111111'
const NEW = '22222222-2222-4222-8222-222222222222'

beforeEach(() => {
  vi.clearAllMocks()
  readCalendarFeedToken.mockResolvedValue({ ok: true, value: OLD })
  rotateCalendarFeedToken.mockResolvedValue({ ok: true, value: NEW })
})

const link = () => screen.getByRole('textbox', { name: /calendar feed link for personal/i })

test("shows the caller's feed link for this Board, with the subscribe form beside it", async () => {
  render(<CalendarFeedPanel board={BOARD} onClose={() => {}} />)

  expect(await screen.findByDisplayValue(new RegExp(`/functions/v1/ical\\?token=${OLD}$`))).toBe(
    link(),
  )
  expect(readCalendarFeedToken).toHaveBeenCalledWith('b1')
  expect(screen.getByRole('link', { name: /subscribe/i }).getAttribute('href')).toMatch(
    new RegExp(`^webcal://.*/functions/v1/ical\\?token=${OLD}$`),
  )
})

test('states plainly what holding the link means', async () => {
  // #277 requires the capability statement beside the link, not behind a help icon: whoever holds
  // the URL reads the Board, calendar apps store it unprotected, and rotation is the only revocation.
  render(<CalendarFeedPanel board={BOARD} onClose={() => {}} />)
  await screen.findByDisplayValue(new RegExp(OLD))

  const statement = screen.getByTestId('calendar-feed-capability').textContent ?? ''
  expect(statement).toMatch(/anyone with this link can see/i)
  expect(statement).toMatch(/without signing in/i)
  expect(statement).toMatch(/store it unprotected/i)
  expect(statement).toMatch(/rotating the link is the only way/i)
})

test('a failed read says so, and shows no link', async () => {
  readCalendarFeedToken.mockResolvedValue({
    ok: false,
    failure: { reason: 'unknown', message: 'Failed to fetch' },
  })
  render(<CalendarFeedPanel board={BOARD} onClose={() => {}} />)

  expect((await screen.findByRole('alert')).textContent).toMatch(/failed to fetch/i)
  expect(screen.queryByRole('textbox')).toBeNull()
  expect(screen.queryByRole('link', { name: /subscribe/i })).toBeNull()
})

test('rotating asks first, then replaces the link everywhere on the panel', async () => {
  const user = userEvent.setup()
  render(<CalendarFeedPanel board={BOARD} onClose={() => {}} />)
  await screen.findByDisplayValue(new RegExp(OLD))

  await user.click(screen.getByRole('button', { name: /rotate link/i }))
  // Nothing has happened yet: the first click only arms the confirmation.
  expect(rotateCalendarFeedToken).not.toHaveBeenCalled()
  expect(screen.getByText(/stops working everywhere/i)).toBeTruthy()

  await user.click(screen.getByRole('button', { name: /^rotate$/i }))
  expect(rotateCalendarFeedToken).toHaveBeenCalledWith('b1')
  expect(await screen.findByDisplayValue(new RegExp(NEW))).toBe(link())
  expect(screen.getByRole('link', { name: /subscribe/i }).getAttribute('href')).toContain(NEW)
  expect(document.body.innerHTML).not.toContain(OLD)
})

test('cancelling a rotation leaves the link as it was', async () => {
  const user = userEvent.setup()
  render(<CalendarFeedPanel board={BOARD} onClose={() => {}} />)
  await screen.findByDisplayValue(new RegExp(OLD))

  await user.click(screen.getByRole('button', { name: /rotate link/i }))
  await user.click(screen.getByRole('button', { name: /cancel/i }))
  expect(rotateCalendarFeedToken).not.toHaveBeenCalled()
  expect(link()).toHaveProperty('value', expect.stringContaining(OLD))
  expect(screen.queryByText(/stops working everywhere/i)).toBeNull()
})

test('a failed rotation keeps the old link and says why', async () => {
  // The old token is still the live one when the command fails, so it must stay on screen: hiding
  // it would suggest it had been revoked.
  rotateCalendarFeedToken.mockResolvedValue({
    ok: false,
    failure: { reason: 'membership-ended', message: 'You no longer have access to this board.' },
  })
  const user = userEvent.setup()
  render(<CalendarFeedPanel board={BOARD} onClose={() => {}} />)
  await screen.findByDisplayValue(new RegExp(OLD))

  await user.click(screen.getByRole('button', { name: /rotate link/i }))
  await user.click(screen.getByRole('button', { name: /^rotate$/i }))
  expect((await screen.findByRole('alert')).textContent).toMatch(/no longer have access/i)
  expect(link()).toHaveProperty('value', expect.stringContaining(OLD))
})

test('copy puts the https link on the clipboard', async () => {
  const user = userEvent.setup()
  render(<CalendarFeedPanel board={BOARD} onClose={() => {}} />)
  await screen.findByDisplayValue(new RegExp(OLD))

  await user.click(screen.getByRole('button', { name: /copy link/i }))
  expect(await navigator.clipboard.readText()).toMatch(
    new RegExp(`^https?://.*/functions/v1/ical\\?token=${OLD}$`),
  )
  expect(await screen.findByRole('button', { name: /copied/i })).toBeTruthy()
})

test('closing hands control back to the owner of the panel', async () => {
  const onClose = vi.fn()
  const user = userEvent.setup()
  render(<CalendarFeedPanel board={BOARD} onClose={onClose} />)
  await screen.findByDisplayValue(new RegExp(OLD))

  await user.click(screen.getByRole('button', { name: /^hide$/i }))
  expect(onClose).toHaveBeenCalledOnce()
})
