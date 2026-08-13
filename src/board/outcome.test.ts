import { expect, test } from 'vitest'
import { boardFailed, boardFailure, boardFailureUnknown, type BoardFailureReason } from './outcome'

const KNOWN: Exclude<BoardFailureReason, 'unknown'>[] = [
  'last-owner',
  'stale-revision',
  'membership-ended',
  'board-deleted',
]

test.each(KNOWN)('%s carries our own copy, not a vendor string', (reason) => {
  const failure = boardFailure(reason)
  expect(failure.reason).toBe(reason)
  expect(failure.message.length).toBeGreaterThan(0)
})

test('every known reason has a distinct message', () => {
  // Two reasons sharing copy means the UI cannot actually tell a user what happened, which defeats
  // the point of distinguishing them in the union at all.
  const messages = KNOWN.map((r) => boardFailure(r).message)
  expect(new Set(messages).size).toBe(KNOWN.length)
})

test('membership-ended and board-deleted do not imply each other', () => {
  // Load-bearing wording, not style. Telling a removed member the board was deleted leaks a state
  // change they are no longer entitled to observe; telling a member of a deleted board they were
  // removed invites them to ask a co-owner why. Each message must name only its own condition.
  const ended = boardFailure('membership-ended').message.toLowerCase()
  const deleted = boardFailure('board-deleted').message.toLowerCase()

  expect(ended).not.toContain('delet')
  expect(deleted).not.toContain('access')
  expect(deleted).not.toContain('remov')
})

test('boardFailed produces the not-ok shape', () => {
  const outcome = boardFailed('last-owner')
  expect(outcome.ok).toBe(false)
  expect(outcome.failure.reason).toBe('last-owner')
})

test('unknown passes the underlying message through', () => {
  // The degradation path: an unmapped failure renders its own text rather than disappearing.
  const failure = boardFailureUnknown('duplicate key value violates unique constraint')
  expect(failure.reason).toBe('unknown')
  expect(failure.message).toBe('duplicate key value violates unique constraint')
})
