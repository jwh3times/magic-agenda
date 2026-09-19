import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'
import type { Attachment } from '../data/attachments'

const h = vi.hoisted(() => ({
  listAttachments: vi.fn(),
  uploadAttachment: vi.fn(),
  removeAttachment: vi.fn(),
  signedUrl: vi.fn(),
}))

vi.mock('../data/attachments', () => ({
  listAttachments: h.listAttachments,
  uploadAttachment: h.uploadAttachment,
  removeAttachment: h.removeAttachment,
  signedUrl: h.signedUrl,
}))

import { AttachmentsSection } from './AttachmentsSection'

const CHROME = {
  fg: '#111',
  sub: '#666',
  fieldBg: '#fff',
  border: '#ddd',
  ctlFont: '13px sans-serif',
  btn: () => ({}),
}

const attachment = (over: Partial<Attachment> = {}): Attachment => ({
  id: 'a1',
  taskId: 't1',
  boardId: 'b1',
  storagePath: 'b1/t1/a1',
  filename: 'diagram.png',
  mimeType: 'image/png',
  sizeBytes: 2048,
  uploadedBy: 'u1',
  createdAt: '2026-09-19T00:00:00Z',
  ...over,
})

const renderSection = (readOnly = false) =>
  render(<AttachmentsSection boardId="b1" taskId="t1" readOnly={readOnly} chrome={CHROME} />)

beforeEach(() => {
  h.listAttachments.mockReset().mockResolvedValue([])
  h.uploadAttachment.mockReset().mockResolvedValue(attachment())
  h.removeAttachment.mockReset().mockResolvedValue(undefined)
  h.signedUrl.mockReset().mockResolvedValue('https://signed.example/x')
})

test('an empty list says so rather than showing nothing', async () => {
  renderSection()
  expect(await screen.findByText('No attachments yet.')).toBeTruthy()
})

test('attachments are listed with their size', async () => {
  h.listAttachments.mockResolvedValue([
    attachment(),
    attachment({
      id: 'a2',
      filename: 'spec.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1_048_576,
    }),
  ])
  renderSection()

  expect(await screen.findByText('diagram.png')).toBeTruthy()
  expect(screen.getByText('spec.pdf')).toBeTruthy()
  expect(screen.getByText('2 KB')).toBeTruthy()
  expect(screen.getByText('1.0 MB')).toBeTruthy()
})

test('only images get a signed thumbnail; a PDF gets a label instead', async () => {
  // Signing a URL for a PDF would spend a request on something we never render as an image.
  h.listAttachments.mockResolvedValue([
    attachment(),
    attachment({ id: 'a2', filename: 'spec.pdf', mimeType: 'application/pdf' }),
  ])
  renderSection()

  await screen.findByText('diagram.png')
  await waitFor(() => expect(h.signedUrl).toHaveBeenCalledTimes(1))
  expect(h.signedUrl).toHaveBeenCalledWith('b1/t1/a1')
  expect(screen.getByText('PDF')).toBeTruthy()
})

test('an oversized file is refused without an upload', async () => {
  // The case the `accept` attribute cannot catch -- it filters by type, never by size -- and the
  // point of checking locally at all: a 20 MB file should not be sent to discover a rule we know.
  renderSection()
  await screen.findByText('No attachments yet.')

  const input = screen.getByTestId('attachment-input') as HTMLInputElement
  const big = new File(['x'], 'huge.png', { type: 'image/png' })
  Object.defineProperty(big, 'size', { value: 10_485_761 })
  await userEvent.upload(input, big)

  expect(await screen.findByRole('alert')).toHaveTextContent(/10\.0 MB or smaller/)
  expect(h.uploadAttachment).not.toHaveBeenCalled()
})

test('a disallowed type is refused even if it gets past the picker', async () => {
  // `accept` keeps this out of the normal file dialog, so `applyAccept: false` is what simulates
  // the ways it can still arrive -- a drag-drop, or a picker that ignores the hint. The attribute
  // is a convenience, never the check.
  renderSection()
  await screen.findByText('No attachments yet.')

  const input = screen.getByTestId('attachment-input') as HTMLInputElement
  const bad = new File(['<html>'], 'page.html', { type: 'text/html' })
  // `applyAccept: false` belongs on `setup()` in user-event v14, not on the call.
  const user = userEvent.setup({ applyAccept: false })
  await user.upload(input, bad)

  expect(await screen.findByRole('alert')).toHaveTextContent(/PNG, JPEG, GIF, WebP, or PDF/)
  expect(h.uploadAttachment).not.toHaveBeenCalled()
})

test('a valid file uploads and the list reloads', async () => {
  renderSection()
  await screen.findByText('No attachments yet.')
  h.listAttachments.mockResolvedValue([attachment()])

  const input = screen.getByTestId('attachment-input') as HTMLInputElement
  await userEvent.upload(input, new File(['x'], 'diagram.png', { type: 'image/png' }))

  await waitFor(() => expect(h.uploadAttachment).toHaveBeenCalledOnce())
  expect(h.uploadAttachment.mock.calls[0][0]).toBe('b1')
  expect(h.uploadAttachment.mock.calls[0][1]).toBe('t1')
  expect(await screen.findByText('diagram.png')).toBeTruthy()
})

test('a failed upload surfaces the reason and leaves the list alone', async () => {
  h.uploadAttachment.mockRejectedValue(new Error('storage unavailable'))
  renderSection()
  await screen.findByText('No attachments yet.')

  const input = screen.getByTestId('attachment-input') as HTMLInputElement
  await userEvent.upload(input, new File(['x'], 'diagram.png', { type: 'image/png' }))

  expect(await screen.findByRole('alert')).toHaveTextContent('storage unavailable')
  expect(screen.getByText('No attachments yet.')).toBeTruthy()
})

test('removing calls through and reloads', async () => {
  h.listAttachments.mockResolvedValue([attachment()])
  renderSection()
  await screen.findByText('diagram.png')

  h.listAttachments.mockResolvedValue([])
  await userEvent.click(screen.getByRole('button', { name: 'Remove diagram.png' }))

  await waitFor(() => expect(h.removeAttachment).toHaveBeenCalledOnce())
  expect(await screen.findByText('No attachments yet.')).toBeTruthy()
})

test('read-only offers no way to add or remove', async () => {
  // The board falls back to read-only on an offline snapshot, and a Viewer is read-only too. The
  // database refuses either way; this is about not offering a control that cannot work.
  h.listAttachments.mockResolvedValue([attachment()])
  renderSection(true)

  await screen.findByText('diagram.png')
  expect(screen.queryByRole('button', { name: /^Remove/ })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Add attachment' })).toBeNull()
  expect(screen.queryByTestId('attachment-input')).toBeNull()
})

test('a failed load reports it rather than looking empty', async () => {
  // "No attachments yet" for a load that failed would be a lie, and the user would not know to
  // retry.
  h.listAttachments.mockRejectedValue(new Error('offline'))
  renderSection()
  expect(await screen.findByRole('alert')).toHaveTextContent('offline')
})
