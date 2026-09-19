import { expect, test } from 'vitest'
import {
  ATTACHMENT_ACCEPT,
  ATTACHMENT_FILENAME_MAX,
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_MIME_TYPES,
  attachmentFileError,
  formatFileSize,
  isAllowedMimeType,
  isImageMimeType,
} from './attachmentLimits'

const file = (over: Partial<{ name: string; size: number; type: string }> = {}) => ({
  name: 'diagram.png',
  size: 2048,
  type: 'image/png',
  ...over,
})

test('the limits match the database constraints they mirror', () => {
  // These four numbers/lists are duplicated in
  // `20260918210000_task_attachments_foundation.sql`. If one side moves, the editor either blocks
  // a file the server accepts or promises one it refuses -- so pin them here rather than trusting
  // two files to be edited together.
  expect(ATTACHMENT_MAX_BYTES).toBe(10_485_760)
  expect(ATTACHMENT_FILENAME_MAX).toBe(255)
  expect([...ATTACHMENT_MIME_TYPES]).toEqual([
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
    'application/pdf',
  ])
  expect(ATTACHMENT_ACCEPT).toBe('image/png,image/jpeg,image/gif,image/webp,application/pdf')
})

test('an ordinary file is accepted', () => {
  expect(attachmentFileError(file())).toBeNull()
})

test('the size boundary is exact on both sides', () => {
  expect(attachmentFileError(file({ size: ATTACHMENT_MAX_BYTES }))).toBeNull()
  expect(attachmentFileError(file({ size: ATTACHMENT_MAX_BYTES + 1 }))).toMatch(
    /10\.0 MB or smaller/,
  )
})

test('an empty file is refused, not treated as merely small', () => {
  // `size_bytes > 0` is the CHECK. Without this branch a zero-byte file passes every "too big"
  // test, spends the upload, and is then refused by the database.
  expect(attachmentFileError(file({ size: 0 }))).toBe('That file is empty.')
})

test('a disallowed type and an unknown type give the same message', () => {
  // The browser reports "" when it cannot guess. Both are refused server-side, so saying different
  // things would make "" look like a special case worth working around.
  expect(attachmentFileError(file({ type: 'text/html' }))).toMatch(/PNG, JPEG, GIF, WebP, or PDF/)
  expect(attachmentFileError(file({ type: '' }))).toMatch(/PNG, JPEG, GIF, WebP, or PDF/)
})

test('a filename is measured in code points, like PostgreSQL char_length', () => {
  // `.length` counts a surrogate pair twice and would refuse a name the server accepts. 255
  // astral characters are 510 UTF-16 units.
  const astral = '😀'.repeat(ATTACHMENT_FILENAME_MAX)
  expect(astral.length).toBe(ATTACHMENT_FILENAME_MAX * 2)
  expect(attachmentFileError(file({ name: astral }))).toBeNull()
  expect(attachmentFileError(file({ name: '😀'.repeat(ATTACHMENT_FILENAME_MAX + 1) }))).toMatch(
    /255 characters or fewer/,
  )
})

test('a name that is only whitespace is refused', () => {
  expect(attachmentFileError(file({ name: '   ' }))).toBe('That file has no name.')
})

test('size is refused before type, so the first message names the biggest problem', () => {
  // Ordering is a choice, not an accident: a 20 MB .exe should say "too big" rather than sending
  // the user off to convert it to a PNG first.
  expect(attachmentFileError(file({ size: ATTACHMENT_MAX_BYTES + 1, type: 'text/html' }))).toMatch(
    /or smaller/,
  )
})

test('only the allowed image types count as images', () => {
  expect(isImageMimeType('image/png')).toBe(true)
  expect(isImageMimeType('image/webp')).toBe(true)
  // An image type the bucket refuses must not get a thumbnail: we would sign a URL for a file
  // that cannot exist.
  expect(isImageMimeType('image/svg+xml')).toBe(false)
  expect(isImageMimeType('application/pdf')).toBe(false)
  expect(isAllowedMimeType('application/pdf')).toBe(true)
})

test('sizes read the way a file manager shows them', () => {
  expect(formatFileSize(512)).toBe('512 B')
  expect(formatFileSize(2048)).toBe('2 KB')
  expect(formatFileSize(ATTACHMENT_MAX_BYTES)).toBe('10.0 MB')
})
