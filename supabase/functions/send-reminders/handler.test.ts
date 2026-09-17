import { assertEquals } from 'jsr:@std/assert@1'
import { createHandler } from './handler.ts'

const unused = () => {
  throw new Error('dependency should not be created')
}

Deno.test('sender requires POST and the dedicated cron bearer secret', async () => {
  const handler = createHandler({
    secret: 'expected',
    store: unused,
    push: unused,
    now: () => 0,
  })
  assertEquals((await handler(new Request('http://localhost/', { method: 'GET' }))).status, 405)
  assertEquals((await handler(new Request('http://localhost/', { method: 'POST' }))).status, 401)
  assertEquals(
    (
      await handler(
        new Request('http://localhost/', {
          method: 'POST',
          headers: { authorization: 'Bearer wrong' },
        }),
      )
    ).status,
    401,
  )
})

Deno.test('an authenticated invocation returns only aggregate counts', async () => {
  const store = {
    candidates: () => Promise.resolve([]),
  }
  const handler = createHandler({
    secret: 'expected',
    store: () => store as never,
    push: () => ({ send: () => Promise.resolve() }),
    now: () => 0,
  })
  const response = await handler(
    new Request('http://localhost/', {
      method: 'POST',
      headers: { authorization: 'Bearer expected' },
    }),
  )
  assertEquals(response.status, 200)
  assertEquals(await response.json(), {
    candidates: 0,
    delivered: 0,
    retried: 0,
    dead: 0,
  })
})
