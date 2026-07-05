import { assertEquals } from 'jsr:@std/assert@1'
import { handler } from './handler.ts'

Deno.test('OPTIONS preflight succeeds', async () => {
  const res = await handler(new Request('http://localhost/', { method: 'OPTIONS' }))
  assertEquals(res.status, 200)
})

Deno.test('rejects non-POST methods with 405', async () => {
  const res = await handler(new Request('http://localhost/', { method: 'GET' }))
  assertEquals(res.status, 405)
})

Deno.test('rejects a request without a valid JWT with 401', async () => {
  const res = await handler(new Request('http://localhost/', { method: 'POST' }))
  assertEquals(res.status, 401)
})
