import { afterEach, expect, test } from 'vitest'
import { clearBoardView, readBoardView, writeBoardView } from './viewStorage'

afterEach(() => sessionStorage.clear())

test('write then read round-trips a valid view', () => {
  writeBoardView('week')
  expect(readBoardView()).toBe('week')
})

test('read returns null when nothing is stored', () => {
  expect(readBoardView()).toBeNull()
})

test('read rejects an unknown stored value', () => {
  sessionStorage.setItem('ma-board-view', 'bogus')
  expect(readBoardView()).toBeNull()
})

test('clear removes the stored view', () => {
  writeBoardView('agenda')
  clearBoardView()
  expect(readBoardView()).toBeNull()
})
