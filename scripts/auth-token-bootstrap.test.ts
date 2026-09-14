// @vitest-environment node
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { expect, test } from 'vitest'

const source = readFileSync(new URL('../public/auth-token-bootstrap.js', import.meta.url), 'utf8')

interface Capture {
  read(): string | null
  consume(): void
}

function runBootstrap(pathname: string, search: string, state: unknown = null) {
  const replaceCalls: unknown[][] = []
  let storageReads = 0
  const location = { pathname, search }
  const history = {
    state,
    replaceState(...args: unknown[]) {
      replaceCalls.push(args)
      location.pathname = String(args[2])
      location.search = ''
    },
  }
  const browserWindow = { location, history }
  for (const name of ['localStorage', 'sessionStorage', 'indexedDB']) {
    Object.defineProperty(browserWindow, name, {
      get() {
        storageReads += 1
        throw new Error(`${name} must not be read`)
      },
    })
  }

  runInNewContext(source, { URLSearchParams, window: browserWindow })

  return {
    capture: (browserWindow as typeof browserWindow & { __magicAgendaAuthTokenCapture: Capture })
      .__magicAgendaAuthTokenCapture,
    location,
    replaceCalls,
    storageReads,
  }
}

test.each([
  ['/auth/reset', 'recovery-token'],
  ['/auth/confirm', 'signup-token'],
])('captures and scrubs an emailed token on %s', (pathname, tokenHash) => {
  const state = { navigation: 'kept' }
  const result = runBootstrap(pathname, `?token_hash=${tokenHash}&type=ignored`, state)

  expect(result.location).toEqual({ pathname, search: '' })
  expect(result.replaceCalls).toEqual([[state, '', pathname]])
  expect(result.capture.read()).toBe(tokenHash)
  expect(result.capture.read()).toBe(tokenHash)
})

test('leaves non-redemption routes untouched', () => {
  const result = runBootstrap('/login', '?token_hash=not-ours&type=recovery')

  expect(result.location).toEqual({
    pathname: '/login',
    search: '?token_hash=not-ours&type=recovery',
  })
  expect(result.replaceCalls).toEqual([])
  expect(result.capture.read()).toBeNull()
})

test('normalizes an empty token while still scrubbing the auth query', () => {
  const result = runBootstrap('/auth/reset', '?token_hash=&type=recovery')

  expect(result.location).toEqual({ pathname: '/auth/reset', search: '' })
  expect(result.capture.read()).toBeNull()
})

test('keeps the token in closure memory and forgets it only when consumed', () => {
  const result = runBootstrap('/auth/confirm', '?token_hash=single-use&type=signup')

  expect(result.storageReads).toBe(0)
  expect(result.capture.read()).toBe('single-use')
  result.capture.consume()
  expect(result.capture.read()).toBeNull()
})
