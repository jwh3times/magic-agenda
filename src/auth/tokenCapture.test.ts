import { beforeEach, expect, test } from 'vitest'
import { installCapturedAuthToken } from '../test/authTokenCapture'
import { consumeCapturedAuthToken, readCapturedAuthToken } from './tokenCapture'

beforeEach(() => {
  installCapturedAuthToken(null)
})

test('reads the captured token idempotently, then consumes it', () => {
  installCapturedAuthToken('single-use')

  expect(readCapturedAuthToken()).toBe('single-use')
  expect(readCapturedAuthToken()).toBe('single-use')
  consumeCapturedAuthToken()
  expect(readCapturedAuthToken()).toBeNull()
})

test('returns no token when the bootstrap API is unavailable', () => {
  delete window.__magicAgendaAuthTokenCapture
  expect(readCapturedAuthToken()).toBeNull()
  expect(() => consumeCapturedAuthToken()).not.toThrow()
})
