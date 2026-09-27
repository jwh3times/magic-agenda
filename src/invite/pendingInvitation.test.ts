import { afterEach, beforeEach, expect, test } from 'vitest'
import {
  PENDING_INVITATION_TTL_MS,
  adoptCapturedInvitation,
  clearPendingInvitation,
  invitationLink,
  readPendingInvitation,
  savePendingInvitation,
} from './pendingInvitation'

const NOW = 1_800_000_000_000

beforeEach(() => localStorage.clear())
afterEach(() => {
  delete window.__magicAgendaInvitationCapture
})

test('a saved token reads back until it expires, then is cleared', () => {
  savePendingInvitation('tok', NOW)
  expect(readPendingInvitation(NOW + PENDING_INVITATION_TTL_MS - 1)).toBe('tok')
  expect(readPendingInvitation(NOW + PENDING_INVITATION_TTL_MS)).toBeNull()
  // Expiry clears it rather than leaving a dead entry behind.
  expect(localStorage.length).toBe(0)
})

test('a malformed or future-dated entry is treated as none and cleared', () => {
  localStorage.setItem('ma-pending-invitation', '{{{')
  expect(readPendingInvitation(NOW)).toBeNull()
  expect(localStorage.length).toBe(0)

  savePendingInvitation('tok', NOW + 60_000)
  expect(readPendingInvitation(NOW)).toBeNull()
})

test('clearing forgets the token', () => {
  savePendingInvitation('tok', NOW)
  clearPendingInvitation()
  expect(readPendingInvitation(NOW)).toBeNull()
})

test('adopting moves the bootstrap capture into storage and consumes it', () => {
  let captured: string | null = 'from-link'
  window.__magicAgendaInvitationCapture = {
    read: () => captured,
    consume: () => {
      captured = null
    },
  }
  adoptCapturedInvitation(NOW)
  expect(readPendingInvitation(NOW)).toBe('from-link')
  expect(captured).toBeNull()

  // Idempotent: a second adoption (StrictMode) neither fails nor clears what was saved.
  adoptCapturedInvitation(NOW)
  expect(readPendingInvitation(NOW)).toBe('from-link')
})

test('a newer link replaces an older pending one', () => {
  savePendingInvitation('old', NOW)
  savePendingInvitation('new', NOW + 1)
  expect(readPendingInvitation(NOW + 2)).toBe('new')
})

test('the link carries the token as its only parameter', () => {
  expect(invitationLink('a-b_c', 'https://magicagenda.app')).toBe(
    'https://magicagenda.app/invite?token=a-b_c',
  )
})
