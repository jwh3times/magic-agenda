import { expect, test } from 'vitest'
import { makeMockTasks } from './mockTasks'
import { checklistBytes, taskLimitError } from './taskLimits'
import { intendSave } from './editIntent'

const base = {
  ...makeMockTasks()[0],
  title: 'Valid',
  description: '',
  checklist: [],
  recurInterval: 1,
}
test('character limits count Unicode code points and accept exact boundaries', () => {
  expect(
    taskLimitError({ ...base, title: '🎉'.repeat(500), description: 'é'.repeat(20000) }),
  ).toBeNull()
  expect(taskLimitError({ ...base, title: '🎉'.repeat(501) })).toMatch(/title/)
  expect(taskLimitError({ ...base, description: 'é'.repeat(20001) })).toMatch(/description/)
})
test('checklist count and UTF-8 size limits allow the boundary and reject one over it', () => {
  const item = { id: 'i', text: '', done: false }
  expect(taskLimitError({ ...base, checklist: Array.from({ length: 200 }, () => item) })).toBeNull()
  expect(taskLimitError({ ...base, checklist: Array.from({ length: 201 }, () => item) })).toMatch(
    /200/,
  )
  const text = 'x'.repeat(65536 - checklistBytes([item]))
  expect(taskLimitError({ ...base, checklist: [{ ...item, text }] })).toBeNull()
  expect(taskLimitError({ ...base, checklist: [{ ...item, text: text + 'x' }] })).toMatch(/64 KiB/)
})
test.each([0, -1, 367, 1.5, Infinity, NaN])(
  'invalid interval %s cannot save even with a chosen scope',
  (recurInterval) => {
    const draft = { ...base, recurInterval }
    expect(taskLimitError(draft)).toMatch(/interval/)
    expect(intendSave(base, draft, false, '2026-09-06T00:00:00Z', 'future')).toEqual({
      kind: 'blocked',
    })
  },
)
