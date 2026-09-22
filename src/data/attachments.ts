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

/** Named once: every read of this table returns the same shape, including undo's capture. */
const ATTACHMENT_COLUMNS =
  'id, task_id, board_id, storage_path, filename, mime_type, size_bytes, uploaded_by, created_at'

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
    .select(ATTACHMENT_COLUMNS)
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
    .select(ATTACHMENT_COLUMNS)
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
 * **This is what makes #404 fixable**, and the two functions below are the fix: the bytes are
 * still there, so undo only has to put the rows back. Deleting the files here would have made that
 * impossible, and no later change should start doing so without answering undo first.
 */

/** One page of a capture. PostgREST caps a response; a full page is never proof of the last one. */
const CAPTURE_PAGE = 1000
/** How many task ids go into one `in (...)`, which travels in the URL. */
const CAPTURE_CHUNK = 50

async function capturePage(taskIds: readonly string[]): Promise<Attachment[]> {
  const out: Attachment[] = []
  for (let from = 0; ; from += CAPTURE_PAGE) {
    const { data, error } = await supabase
      .from('task_attachments')
      .select(ATTACHMENT_COLUMNS)
      .in('task_id', taskIds)
      .order('id', { ascending: true })
      .range(from, from + CAPTURE_PAGE - 1)
    if (error) throw new Error(error.message)
    const rows = data ?? []
    out.push(...rows.map(rowToAttachment))
    // A short page is the only proof there is no next one: a full page may be the API's cap
    // rather than the end of the table, which is the same trap `loadBoardTasks` pages around.
    if (rows.length < CAPTURE_PAGE) return out
  }
}

/**
 * The attachment rows of Tasks that are about to be deleted, so undo can put them back (#404).
 *
 * Read **between the optimistic removal and the DELETE**, which is the only window where both
 * things are true: the rows still exist, and the user has already seen the Task go. Reading before
 * the optimistic removal would make every delete wait a round-trip for an answer that is almost
 * always "none"; reading after the DELETE is too late, because the cascade has taken them.
 *
 * **Never throws, and an error yields no capture rather than a partial one.** A delete must not
 * fail because the attachment read did — the cost of returning empty is exactly the behaviour
 * shipped before this fix, a Task that comes back without its attachments, which is a worse undo
 * and not a broken delete. All-or-nothing keeps the entry's meaning simple: what it holds is what
 * undo restores.
 */
export async function captureTaskAttachments(taskIds: readonly string[]): Promise<Attachment[]> {
  if (taskIds.length === 0) return []
  try {
    const out: Attachment[] = []
    for (let i = 0; i < taskIds.length; i += CAPTURE_CHUNK) {
      out.push(...(await capturePage(taskIds.slice(i, i + CAPTURE_CHUNK))))
    }
    return out
  } catch {
    return []
  }
}

/**
 * Re-insert captured attachment rows once undo has restored the Tasks they belong to (#404).
 *
 * **Order matters: the Tasks first.** `task_attachments` carries a composite foreign key to
 * `tasks (board_id, id)`, so a row inserted before its Task is refused.
 *
 * **INSERT ... ON CONFLICT DO NOTHING, not a plain upsert**, for two reasons that point the same
 * way. An undo entry covers the ids the *action* touched, not only the ids it deleted — a bulk
 * delete that retires a Series also records rows it merely updated — so some captured attachments
 * may still be present, and putting them back must be a no-op rather than a conflict. And UPDATE
 * on this table grants `filename` and nothing else, so the update half of a real upsert would be
 * refused on `board_id`, `task_id`, `mime_type`, and `size_bytes` anyway.
 *
 * `storage_path` is generated from `id`, and the id is the captured one — so a restored row
 * addresses the file that was never deleted. `uploaded_by` and `created_at` are stamped afresh,
 * the same limit a restored Task's attribution already carries (see `undo` in `useTasks.ts`).
 */
export async function restoreAttachments(attachments: readonly Attachment[]): Promise<void> {
  if (attachments.length === 0) return
  const { error } = await supabase.from('task_attachments').upsert(
    // Every row names every column, so PostgREST's key-union rule cannot turn an omitted column
    // into an explicit NULL here (see AGENTS.md, "A `not null default` does not protect a
    // multi-row insert").
    attachments.map((a) => ({
      id: a.id,
      board_id: a.boardId,
      task_id: a.taskId,
      filename: a.filename,
      mime_type: a.mimeType,
      size_bytes: a.sizeBytes,
    })),
    { onConflict: 'id', ignoreDuplicates: true },
  )
  if (error) throw new Error(error.message)
}

/**
 * How many attachments the Board holds, for the export dialog to name (#398).
 *
 * A head request with an exact count, **not** a select whose rows are then counted. That is not a
 * micro-optimisation: PostgREST caps a response at `max_rows` and still returns success, so a
 * length is a floor rather than a total — the same trap `loadBoardTasks` pages around and
 * `captureTaskAttachments` above checks for. Asking the server to count removes the possibility
 * instead of guarding against it.
 *
 * **Returns null instead of throwing**, which is deliberately unlike every other read in this
 * module. The number is an addition to copy that is already true without it, so a failed count must
 * degrade to that copy rather than block an export or, worse, report a wrong total.
 */
export async function countBoardAttachments(boardId: string): Promise<number | null> {
  const { count, error } = await supabase
    .from('task_attachments')
    .select('*', { count: 'exact', head: true })
    .eq('board_id', boardId)
  // A missing count is as unusable as an error: PostgREST omits the header unless asked for it, and
  // reading that absence as zero is the one wrong answer this function must not give. The test is
  // `typeof`, not `=== null`: supabase-js types this `number | null`, but an absent header arrives
  // as `undefined`, which a null check lets through to be interpolated into copy as "undefined".
  if (error || typeof count !== 'number') return null
  return count
}

/**
 * The clause naming what an export will leave behind, or null when there is nothing to name.
 *
 * Null for both zero and an unknown count, and the reasons differ: zero is silence because nothing
 * would be lost, while unknown is silence because the caller's static sentence already says
 * attachments are not included and a guessed number would make it false.
 */
export function excludedAttachmentsNotice(count: number | null): string | null {
  if (typeof count !== 'number' || count <= 0) return null
  return `This Board has ${count} ${count === 1 ? 'attachment' : 'attachments'}, which the file will not contain.`
}
