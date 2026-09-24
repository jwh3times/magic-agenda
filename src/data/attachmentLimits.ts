/**
 * What the database and the storage bucket will accept for an attachment (#278).
 *
 * These mirror three server-side rules, and none of them is the boundary: the upload command
 * detects the actual file type, the bucket's own `file_size_limit` and `allowed_mime_types` refuse
 * the bytes, and `task_attachments`'
 * `task_attachments_size_within_limit` / `_mime_allowed` / `_filename_nonempty` refuse the row.
 * This module exists so the editor can say *why* before spending an upload on a rejection the
 * server was always going to make, in the same spirit as `taskLimits.ts`.
 *
 * Keep the numbers in step with `20260918210000_task_attachments_foundation.sql` and the
 * `upload-attachment` Edge Function. Changing one without the others means the editor either blocks
 * a file the server would take, or promises one it will refuse. Board-wide limits (100 MiB and
 * 1,000 objects) are enforced transactionally by `reserve_attachment_upload`, not this file.
 */

/** 10 MiB, the same literal the bucket and the CHECK constraint use. */
export const ATTACHMENT_MAX_BYTES = 10_485_760

/** `char_length` between 1 and 255, matching `task_attachments_filename_nonempty`. */
export const ATTACHMENT_FILENAME_MAX = 255

export const ATTACHMENT_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
] as const

export type AttachmentMimeType = (typeof ATTACHMENT_MIME_TYPES)[number]

/** For an `<input type="file">` `accept` attribute — a hint to the picker, never a check. */
export const ATTACHMENT_ACCEPT = ATTACHMENT_MIME_TYPES.join(',')

export function isAllowedMimeType(value: string): value is AttachmentMimeType {
  return (ATTACHMENT_MIME_TYPES as readonly string[]).includes(value)
}

/** Whether a thumbnail is worth fetching a signed URL for. PDFs get an icon instead. */
export function isImageMimeType(value: string): boolean {
  return value.startsWith('image/') && isAllowedMimeType(value)
}

/** 1 MiB as a round number, so sizes read the way a file manager shows them. */
const MIB = 1_048_576
const KIB = 1_024

export function formatFileSize(bytes: number): string {
  if (bytes >= MIB) return `${(bytes / MIB).toFixed(1)} MB`
  if (bytes >= KIB) return `${Math.round(bytes / KIB)} KB`
  return `${bytes} B`
}

/**
 * The reason this file cannot be attached, or null.
 *
 * Takes the three fields rather than a `File` so it is callable from a test without constructing
 * one, and so a caller can check a record it has already read back from the database.
 *
 * **A zero-byte file is refused**, which is easy to miss: the CHECK is `size_bytes > 0`, so an
 * empty file passes every "is it too big" test and is then rejected by the database after the
 * upload has already spent its bytes.
 */
export function attachmentFileError(file: {
  name: string
  size: number
  type: string
}): string | null {
  if (file.size === 0) return 'That file is empty.'
  if (file.size > ATTACHMENT_MAX_BYTES) {
    return `Attachments must be ${formatFileSize(ATTACHMENT_MAX_BYTES)} or smaller.`
  }
  // The browser reports an empty string for a type it cannot guess, which the server would refuse
  // as surely as a disallowed one -- so say the same thing for both rather than "" being a
  // mysterious special case.
  if (!isAllowedMimeType(file.type)) return 'Attach a PNG, JPEG, GIF, WebP, or PDF.'

  const name = file.name.trim()
  if (name.length === 0) return 'That file has no name.'
  // Code points, matching PostgreSQL `char_length`, exactly as the Task title and description
  // limits do. `.length` would count a surrogate pair twice and refuse a name the server accepts.
  if (Array.from(name).length > ATTACHMENT_FILENAME_MAX) {
    return `File names must be ${ATTACHMENT_FILENAME_MAX} characters or fewer.`
  }
  return null
}
