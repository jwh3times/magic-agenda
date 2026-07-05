import { assertEquals } from 'jsr:@std/assert@1'
import { handler } from './handler.ts'

Deno.test('OPTIONS preflight succeeds without auth', async () => {
  const res = await handler(new Request('http://localhost/', { method: 'OPTIONS' }))
  assertEquals(res.status, 200)
  assertEquals(res.headers.get('Access-Control-Allow-Origin'), '*')
})

Deno.test('rejects an unauthenticated request with 401', async () => {
  const res = await handler(new Request('http://localhost/', { method: 'POST' }))
  assertEquals(res.status, 401)
})
