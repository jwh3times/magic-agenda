import { beforeEach, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({ fetch: vi.fn<typeof fetch>() }))
vi.mock('../lib/supabase', async () => {
  const { createClient } = await import('@supabase/supabase-js')
  return {
    supabase: createClient('https://example.supabase.co', 'test-key', {
      global: { fetch: h.fetch },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    }),
  }
})
import { loadBoardTasks } from './loadBoardTasks'

function page(ids: string[], count: number | null, from = 0) {
  return new Response(JSON.stringify(ids.map((id) => ({ id }))), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Content-Range': `${from}-${from + ids.length - 1}/${count ?? '*'}`,
    },
  })
}

beforeEach(() => h.fetch.mockReset())

test('pages through a lower server cap using the real PostgREST client', async () => {
  h.fetch.mockResolvedValueOnce(page(['a', 'b'], 3))
  h.fetch.mockResolvedValueOnce(page(['c'], 3, 2))
  const result = await loadBoardTasks('board-1')
  expect(result.error).toBeNull()
  expect(result.data?.map((row) => row.id)).toEqual(['a', 'b', 'c'])
  expect(h.fetch).toHaveBeenCalledTimes(2)
  const urls = h.fetch.mock.calls.map(
    ([input]) => new URL(input instanceof Request ? input.url : input),
  )
  expect(urls.map((url) => url.searchParams.get('offset'))).toEqual(['0', '2'])
  for (const url of urls) {
    expect(url.searchParams.get('board_id')).toBe('eq.board-1')
    expect(url.searchParams.get('order')).toBe('id.asc')
    expect(url.searchParams.get('limit')).toBe('1000')
  }
  expect(new Headers(h.fetch.mock.calls[0][1]?.headers).get('Prefer')).toContain('count=exact')
})

test('an empty Board is complete', async () => {
  h.fetch.mockResolvedValueOnce(page([], 0))
  expect(await loadBoardTasks('board-1')).toMatchObject({ data: [], error: null })
})

test('an exact page boundary needs no out-of-range request', async () => {
  h.fetch.mockResolvedValueOnce(
    page(
      Array.from({ length: 1000 }, (_, i) => String(i)),
      1000,
    ),
  )
  expect((await loadBoardTasks('board-1')).data).toHaveLength(1000)
  expect(h.fetch).toHaveBeenCalledTimes(1)
})

test.each([
  ['changed count', ['c'], 4],
  ['duplicate row', ['b'], 3],
  ['empty page before completion', [], 3],
  ['missing count', ['c'], null],
] as const)('rejects %s without returning partial data', async (_name, ids, count) => {
  h.fetch.mockResolvedValueOnce(page(['a', 'b'], 3))
  h.fetch.mockResolvedValueOnce(page([...ids], count, 2))
  expect(await loadBoardTasks('board-1')).toMatchObject({
    data: null,
    status: 409,
  })
})

test('preserves later-page auth errors and discards accumulated rows', async () => {
  h.fetch.mockResolvedValueOnce(page(['a', 'b'], 3))
  h.fetch.mockResolvedValueOnce(
    new Response(JSON.stringify({ message: 'session expired' }), { status: 401 }),
  )
  expect(await loadBoardTasks('board-1')).toMatchObject({
    data: null,
    status: 401,
    error: { message: 'session expired' },
  })
})

test('refuses an unscoped load', async () => {
  expect((await loadBoardTasks('')).error).not.toBeNull()
  expect(h.fetch).not.toHaveBeenCalled()
})
