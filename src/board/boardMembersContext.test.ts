import { expect, test } from 'vitest'
import type { BoardMember } from './boardMembers'
import { initialsOf, memberName } from './boardMembersContext'

const member = (over: Partial<BoardMember>): BoardMember => ({
  membershipId: 'm1',
  accountId: 'a1',
  role: 'editor',
  displayName: 'Ada Lovelace',
  joinedAt: '2026-09-27T00:00:00Z',
  email: null,
  nickname: null,
  ...over,
})

test('a name prefers the Owner-private label, then the Display Name, then a fallback (#490)', () => {
  expect(memberName(member({ nickname: 'Ada (math)' }))).toBe('Ada (math)')
  expect(memberName(member({}))).toBe('Ada Lovelace')
  // A blank label is no label.
  expect(memberName(member({ nickname: '   ' }))).toBe('Ada Lovelace')
  expect(memberName(member({ displayName: '' }))).toBe('Unnamed member')
  expect(memberName(undefined)).toBe('Unnamed member')
})

test('card initials follow the same name, so an Owner sees the label there too', () => {
  expect(initialsOf(memberName(member({ nickname: 'Countess Byron' })))).toBe('CB')
  expect(initialsOf(memberName(member({})))).toBe('AL')
})
