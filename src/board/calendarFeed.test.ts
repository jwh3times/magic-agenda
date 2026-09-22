import { beforeEach, expect, test, vi } from 'vitest'
import { boardFailure } from './outcome'

const maybeSingle = vi.fn()
const rpc = vi.fn()
const query = {
  select: vi.fn(() => query),
  eq: vi.fn(() => query),
  is: vi.fn(() => query),
  maybeSingle,
}
const from = vi.fn(() => query)

vi.mock('../lib/supabase', () => ({ supabase: { from, rpc } }))

const { calendarFeedUrl, readCalendarFeedToken, rotateCalendarFeedToken, subscribeUrl } =
  await import('./calendarFeed')

const TOKEN = '3f1c2b4a-9d8e-4f7a-8b6c-5d4e3f2a1b0c'

beforeEach(() => {
  vi.clearAllMocks()
})

test('the feed URL names the ical function and carries the token as its only parameter', () => {
  expect(calendarFeedUrl(TOKEN, 'https://ref.supabase.co')).toBe(
    `https://ref.supabase.co/functions/v1/ical?token=${TOKEN}`,
  )
  // A configured base with a trailing slash must not produce `//functions`.
  expect(calendarFeedUrl(TOKEN, 'https://ref.supabase.co/')).toBe(
    `https://ref.supabase.co/functions/v1/ical?token=${TOKEN}`,
  )
})

test('the subscribe link is the same URL on the webcal scheme', () => {
  // webcal:// is what makes the OS hand the URL to a calendar app as a subscription rather than
  // downloading a one-off .ics snapshot that never updates.
  expect(subscribeUrl(`https://ref.supabase.co/functions/v1/ical?token=${TOKEN}`)).toBe(
    `webcal://ref.supabase.co/functions/v1/ical?token=${TOKEN}`,
  )
  expect(subscribeUrl('http://127.0.0.1:54321/functions/v1/ical?token=x')).toBe(
    'webcal://127.0.0.1:54321/functions/v1/ical?token=x',
  )
})

test("reading a token asks for the caller's own current Membership of that Board", async () => {
  maybeSingle.mockResolvedValue({ data: { ical_token: TOKEN }, error: null })

  expect(await readCalendarFeedToken('b1')).toEqual({ ok: true, value: TOKEN })
  expect(from).toHaveBeenCalledWith('board_memberships')
  expect(query.select).toHaveBeenCalledWith('ical_token')
  expect(query.eq).toHaveBeenCalledWith('board_id', 'b1')
  // A current Membership only: an ended one's token no longer works, so showing it would be a lie.
  expect(query.is).toHaveBeenCalledWith('ended_at', null)
})

test('no current Membership reads as membership-ended, not as an error', async () => {
  maybeSingle.mockResolvedValue({ data: null, error: null })
  const result = await readCalendarFeedToken('b1')
  expect(result).toEqual({
    ok: false,
    failure: boardFailure('membership-ended'),
  })
})

test('a read failure is a value carrying the underlying message, never a throw', async () => {
  maybeSingle.mockResolvedValue({ data: null, error: { message: 'boom' } })
  expect(await readCalendarFeedToken('b1')).toEqual({
    ok: false,
    failure: { reason: 'unknown', message: 'boom' },
  })

  maybeSingle.mockRejectedValue(new TypeError('Failed to fetch'))
  expect(await readCalendarFeedToken('b1')).toEqual({
    ok: false,
    failure: { reason: 'unknown', message: 'Failed to fetch' },
  })
})

test('rotating goes through the command and returns the new token', async () => {
  rpc.mockResolvedValue({ data: 'new-token', error: null })
  expect(await rotateCalendarFeedToken('b1')).toEqual({ ok: true, value: 'new-token' })
  expect(rpc).toHaveBeenCalledWith('rotate_ical_token', { p_board_id: 'b1' })
})

test('a rotation that finds no Membership of yours is membership-ended', async () => {
  // The command answers NULL rather than an error when the row is not the caller's.
  rpc.mockResolvedValue({ data: null, error: null })
  expect(await rotateCalendarFeedToken('b1')).toEqual({
    ok: false,
    failure: boardFailure('membership-ended'),
  })
})

test('a rotation failure is a value, never a throw', async () => {
  rpc.mockResolvedValue({ data: null, error: { message: 'nope' } })
  expect(await rotateCalendarFeedToken('b1')).toEqual({
    ok: false,
    failure: { reason: 'unknown', message: 'nope' },
  })

  rpc.mockRejectedValue(new TypeError('Failed to fetch'))
  expect(await rotateCalendarFeedToken('b1')).toEqual({
    ok: false,
    failure: { reason: 'unknown', message: 'Failed to fetch' },
  })
})
