import { supabase } from '../lib/supabase'
import { newId } from '../lib/id'
import { attachmentFileError } from './attachmentLimits'

export const ATTACHMENTS_BUCKET = 'attachments'

/** How long a thumbnail or download link stays valid. The issue's figure: one hour. */
export const SIGNED_URL_TTL_SECONDS = 3600

export type Attachment = {
  id: string
  taskId: string
  boardId: string
  storagePath: string
  filename: string
  mimeType: string
  sizeBytes: number
  uploadedBy: string | null
  createdAt: string
}

type AttachmentRow = {
  id: string
  task_id: string
  board_id: string
  storage_path: string
  filename: string
  mime_type: string
  size_bytes: number
  uploaded_by: string | null
  created_at: string
}

const rowToAttachment = (row: AttachmentRow): Attachment => ({
  id: row.id,
  taskId: row.task_id,
  boardId: row.board_id,
  storagePath: row.storage_path,
  filename: row.filename,
  mimeType: row.mime_type,
  sizeBytes: row.size_bytes,
  uploadedBy: row.uploaded_by,
  createdAt: row.created_at,
})

/** Oldest first, so the list does not reorder under the user when one is added. */
export async function listAttachments(taskId: string): Promise<Attachment[]> {
  const { data, error } = await supabase
    .from('task_attachments')
    .select(
      'id, task_id, board_id, storage_path, filename, mime_type, size_bytes, uploaded_by, created_at',
    )
    .eq('task_id', taskId)
    .order('created_at', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []).map(rowToAttachment)
}

/**
 * Upload a file and record it.
 *
 * **Upload first, insert second — and that order is why `id` is client-generated.** `storage_path`
 * is a generated column derived from `id`, so a client that could not choose `id` would have to
 * insert, read the id back, and only then upload; every failed upload would leave a row describing
 * a file that does not exist, and a connection lost between the two would strand it permanently.
 * PR 1 granted `id` on INSERT precisely so this order is available. Doing it this way leaves the
 * opposite failure — an object with no row — which is the orphan the issue already accepts and
 * which the Board and account sweeps (#399) clean up because they enumerate storage, not rows.
 *
 * The local check is a courtesy, not the boundary: the bucket and the table CHECKs refuse the same
 * things server-side. It exists so a 10 MB upload is not spent discovering a rule we already knew.
 */
export async function uploadAttachment(
  boardId: string,
  taskId: string,
  file: File,
): Promise<Attachment> {
  const rejection = attachmentFileError(file)
  if (rejection) throw new Error(rejection)

  const id = newId()
  const storagePath = `${boardId}/${taskId}/${id}`

  const { error: uploadError } = await supabase.storage
    .from(ATTACHMENTS_BUCKET)
    .upload(storagePath, file, { contentType: file.type, upsert: false })
  if (uploadError) throw new Error(uploadError.message)

  const { data, error } = await supabase
    .from('task_attachments')
    .insert({
      id,
      board_id: boardId,
      task_id: taskId,
      filename: file.name.trim(),
      mime_type: file.type,
      size_bytes: file.size,
    })
    .select(
      'id, task_id, board_id, storage_path, filename, mime_type, size_bytes, uploaded_by, created_at',
    )
    .single()

  if (error) {
    // **Delete the row before removing the object, and do it unconditionally.**
    //
    // An error here does not prove the insert failed: a timeout, an aborted request, or a 5xx
    // after commit all report an error for a row that landed. Removing the object without this
    // would then produce a row describing a file that does not exist -- the state this module
    // claims it cannot reach, permanent, and visible to the user only as a file that will never
    // open. The id is ours, so the delete is a cheap no-op when the insert really did fail.
    await supabase.from('task_attachments').delete().eq('id', id)
    await supabase.storage.from(ATTACHMENTS_BUCKET).remove([storagePath])
    // Always the original failure. What went wrong with the attachment is what the caller needs,
    // not whatever the tidying up reported.
    throw new Error(error.message)
  }

  return rowToAttachment(data)
}

/**
 * Delete an attachment: the row, then a best-effort object removal.
 *
 * **The opposite order from Board deletion, deliberately.** There the Board row carries the
 * membership that authorizes the object delete, so the file has to go first or it can never go at
 * all. Here the Board survives, so the caller keeps that authorization either way and a leftover
 * object stays deletable -- by a retry, or by the Board sweep later. Removing the row first means
 * the UI never shows an attachment whose file is already gone.
 *
 * A failed object removal is therefore not an error the user needs to see. The issue accepts these
 * orphans explicitly and leaves a scheduled cleanup for later.
 */
export async function removeAttachment(attachment: Attachment): Promise<void> {
  // **`.select()` is what tells a refusal from a success.** RLS denies a DELETE by matching zero
  // rows, not by erroring -- so without this a Viewer's delete would return success, the object
  // removal would be refused and ignored, and the attachment would simply reappear on the next
  // load with no explanation. Asking for the deleted row back makes the refusal observable.
  const { data, error } = await supabase
    .from('task_attachments')
    .delete()
    .eq('id', attachment.id)
    .select('id')
  if (error) throw new Error(error.message)
  if (!data || data.length === 0) {
    throw new Error('You do not have permission to remove that attachment.')
  }

  // Best-effort, and genuinely ignorable: the row is gone, which is what was asked for. storage-js
  // resolves its failures as `{ error }` rather than rejecting, so this is checked, not caught.
  await supabase.storage.from(ATTACHMENTS_BUCKET).remove([attachment.storagePath])
}

/**
 * A time-limited URL for one attachment.
 *
 * The bucket is private, so this is the only way to show or download a file. Returns null rather
 * than throwing: a thumbnail that cannot be signed should degrade to a placeholder, not take the
 * editor down with it.
 */
export async function signedUrl(storagePath: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(ATTACHMENTS_BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS)
  if (error || !data) return null
  return data.signedUrl
}

/**
 * **Deleting a Task deliberately leaves its files in storage.**
 *
 * #278 originally specified a best-effort storage delete here. It predates Undo (#271), and the two
 * do not fit: the database cascade removes the `task_attachments` rows, and undo restores the Task
 * row without them — so undoing a delete already loses the attachments at the row level, whatever
 * happens to the bytes. Deleting the files as well would make that loss irreversible at the moment
 * the user clicks a button that offers Undo beside it.
 *
 * Leaving them costs dead storage until the Board or account is deleted, when the sweep in #399
 * collects them — it enumerates storage rather than rows, so it finds exactly these. That is the
 * same class of cost #400 already tracks, and it destroys nothing.
 *
 * The row-level loss is real and separate; it is filed rather than hidden here.
 */
