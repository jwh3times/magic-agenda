import { assertEquals } from 'jsr:@std/assert@1'
import { bearerToken, requireUser } from './auth.ts'

Deno.test('bearerToken extracts the token from a Bearer header', () => {
  assertEquals(bearerToken('Bearer abc.def.ghi'), 'abc.def.ghi')
  assertEquals(bearerToken('bearer abc'), 'abc') // case-insensitive scheme
})

Deno.test('bearerToken returns null for missing or malformed headers', () => {
  assertEquals(bearerToken(null), null)
  assertEquals(bearerToken(''), null)
  assertEquals(bearerToken('Basic dXNlcjpwYXNz'), null)
})

Deno.test('requireUser returns a 401 Response when there is no Authorization header', async () => {
  const result = await requireUser(new Request('http://localhost/'))
  if (!(result instanceof Response)) throw new Error('expected a Response')
  assertEquals(result.status, 401)
})
