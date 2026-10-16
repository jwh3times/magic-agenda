// @vitest-environment node
import { expect, test } from 'vitest'
import { servableShell } from './shell'

/**
 * A `Response` cannot be constructed with `redirected: true`; only a fetch that followed a redirect
 * produces one. Cloudflare Pages answers `/index.html` with `308 -> /`, so that is what the
 * worker's precache of the shell holds in production.
 */
function redirected(body: string, init: ResponseInit): Response {
  const response = new Response(body, init)
  Object.defineProperty(response, 'redirected', { value: true })
  return response
}

test('a redirected shell is copied into a response a navigation may use', async () => {
  const cached = redirected('<!doctype html><p>shell</p>', {
    status: 200,
    statusText: 'OK',
    headers: { 'content-type': 'text/html; charset=utf-8', 'x-probe': 'kept' },
  })

  const servable = servableShell(cached)

  // A navigation's redirect mode is `manual`: answering it with a redirected response is a
  // network error, which is what offline navigation on magicagenda.app produced (#284).
  expect(servable.redirected).toBe(false)
  expect(servable.status).toBe(200)
  expect(servable.statusText).toBe('OK')
  expect(servable.headers.get('content-type')).toBe('text/html; charset=utf-8')
  expect(servable.headers.get('x-probe')).toBe('kept')
  expect(await servable.text()).toBe('<!doctype html><p>shell</p>')
})

test('a shell that was not redirected is served as it is', () => {
  const cached = new Response('<!doctype html>', { status: 200 })
  expect(servableShell(cached)).toBe(cached)
})
