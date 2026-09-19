import { useCallback, useEffect, useRef, useState } from 'react'
import {
  listAttachments,
  removeAttachment,
  signedUrl,
  uploadAttachment,
  type Attachment,
} from '../data/attachments'
import {
  ATTACHMENT_ACCEPT,
  ATTACHMENT_MAX_BYTES,
  attachmentFileError,
  formatFileSize,
  isImageMimeType,
} from '../data/attachmentLimits'

type Props = {
  boardId: string
  taskId: string
  readOnly: boolean
  /** Editor chrome, passed down rather than re-derived so this matches the panel around it. */
  chrome: {
    fg: string
    sub: string
    fieldBg: string
    border: string
    ctlFont: string
    /** The editor's button factory, taking background and foreground -- not a style object. */
    btn: (bg: string, fgc: string, extra?: React.CSSProperties) => React.CSSProperties
  }
}

/**
 * The attachments list for one saved Task (#278).
 *
 * **Only rendered for a Task that already exists**, and that is a constraint rather than a choice:
 * `task_attachments` carries a composite foreign key to `tasks (board_id, id)`, so there is no row
 * to attach to until the Task has been saved. The alternative — holding files in memory and
 * uploading them after the first save — would put a second, quite different failure path (a save
 * that succeeds while its uploads do not) into the editor's most-used flow. `TaskEditor` shows a
 * one-line hint for a new Task instead.
 *
 * Thumbnails use signed URLs with a one-hour life, because the bucket is private and there is no
 * other way to render the bytes. They are fetched per render of this section rather than cached:
 * an hour is long enough that a stale one is rare, and a broken image is a worse failure than a
 * second request.
 */
export function AttachmentsSection({ boardId, taskId, readOnly, chrome }: Props) {
  const [attachments, setAttachments] = useState<Attachment[] | null>(null)
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  /**
   * A generation counter rather than a local `cancelled` flag.
   *
   * Two things need invalidating and a per-call boolean handles neither: the editor can close
   * mid-request, and a second load can start before the first finishes (upload, then reload). Both
   * would otherwise write stale state over fresh. Bumping the counter makes any in-flight load
   * check `generation.current !== mine` and drop its result.
   */
  const generation = useRef(0)

  const load = useCallback(async () => {
    const mine = ++generation.current
    try {
      const rows = await listAttachments(taskId)
      if (generation.current !== mine) return
      setAttachments(rows)

      const signed = await Promise.all(
        rows
          .filter((row) => isImageMimeType(row.mimeType))
          .map(async (row) => [row.id, await signedUrl(row.storagePath)] as const),
      )
      if (generation.current !== mine) return
      setThumbs(Object.fromEntries(signed.filter(([, url]) => url !== null) as [string, string][]))
    } catch (cause) {
      if (generation.current !== mine) return
      setAttachments([])
      setError(cause instanceof Error ? cause.message : 'Could not load attachments.')
    }
  }, [taskId])

  useEffect(() => {
    // Fetching the attachment list IS synchronizing with an external system -- the case the rule's
    // own help text carves out. `load` sets state only after its awaits, so there is no cascading
    // render here; the rule cannot see through the async function to tell.
    //
    // Same caveat as `useBoardDirectory`'s identical disable: this blankets an entire async
    // function, so a synchronous setState added to `load`'s pre-await prefix would be silently
    // un-linted. Re-check this reasoning before adding one.
    // oxlint-disable-next-line react/set-state-in-effect
    void load()
    // Copied into the closure because the ref object is what the cleanup needs, not its value at
    // effect time -- reading `generation.current` directly in cleanup is the pattern the lint rule
    // warns about, and here the whole point is to bump whatever the current value turns out to be.
    const counter = generation
    return () => {
      counter.current++
    }
  }, [load])

  const onPick = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    // Reset immediately so picking the same file twice in a row still fires a change event.
    event.target.value = ''
    if (!file) return

    // Checked here as well as inside `uploadAttachment` so the message appears without a round
    // trip; the upload re-checks because it is also callable from elsewhere.
    const rejection = attachmentFileError(file)
    if (rejection) {
      setError(rejection)
      return
    }

    setBusy(true)
    setError(null)
    try {
      await uploadAttachment(boardId, taskId, file)
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Upload failed.')
    } finally {
      setBusy(false)
    }
  }

  const onRemove = async (attachment: Attachment) => {
    setBusy(true)
    setError(null)
    try {
      await removeAttachment(attachment)
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not remove that attachment.')
    } finally {
      setBusy(false)
    }
  }

  const open = async (attachment: Attachment) => {
    const url = await signedUrl(attachment.storagePath)
    if (!url) {
      setError('Could not open that attachment. Try again.')
      return
    }
    // `noopener` matters on a signed URL: without it the opened document can reach back through
    // `window.opener`, and the URL itself is a bearer token for the next hour.
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  const { fg, sub, fieldBg, border, ctlFont, btn } = chrome

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <span style={{ font: ctlFont, color: sub }}>Attachments</span>
        <span style={{ font: ctlFont, color: sub, fontSize: 11 }}>
          PNG, JPEG, GIF, WebP, PDF · up to {formatFileSize(ATTACHMENT_MAX_BYTES)}
        </span>
      </div>

      {attachments === null ? (
        <span style={{ font: ctlFont, color: sub }}>Loading…</span>
      ) : attachments.length === 0 ? (
        <span style={{ font: ctlFont, color: sub }}>No attachments yet.</span>
      ) : (
        <ul
          style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}
          aria-label="Attachments"
        >
          {attachments.map((attachment) => (
            <li
              key={attachment.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: 6,
                background: fieldBg,
                border: `1px solid ${border}`,
                borderRadius: 6,
              }}
            >
              {thumbs[attachment.id] ? (
                <img
                  src={thumbs[attachment.id]}
                  alt=""
                  width={36}
                  height={36}
                  style={{ objectFit: 'cover', borderRadius: 4, flexShrink: 0 }}
                />
              ) : (
                <span
                  aria-hidden="true"
                  style={{
                    width: 36,
                    height: 36,
                    display: 'grid',
                    placeItems: 'center',
                    borderRadius: 4,
                    border: `1px solid ${border}`,
                    color: sub,
                    fontSize: 11,
                    flexShrink: 0,
                  }}
                >
                  {attachment.mimeType === 'application/pdf' ? 'PDF' : 'FILE'}
                </span>
              )}

              <button
                type="button"
                onClick={() => void open(attachment)}
                style={btn('transparent', fg, {
                  flex: 1,
                  minWidth: 0,
                  textAlign: 'left',
                  border: 'none',
                  padding: 0,
                })}
              >
                <span
                  style={{
                    display: 'block',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {attachment.filename}
                </span>
                <span style={{ font: ctlFont, color: sub, fontSize: 11 }}>
                  {formatFileSize(attachment.sizeBytes)}
                </span>
              </button>

              {!readOnly && (
                <button
                  type="button"
                  onClick={() => void onRemove(attachment)}
                  disabled={busy}
                  aria-label={`Remove ${attachment.filename}`}
                  style={btn(fieldBg, fg, { flexShrink: 0 })}
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {!readOnly && (
        <>
          <input
            ref={fileInput}
            type="file"
            accept={ATTACHMENT_ACCEPT}
            onChange={(event) => void onPick(event)}
            style={{ display: 'none' }}
            data-testid="attachment-input"
          />
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            disabled={busy}
            style={btn(fieldBg, fg, { alignSelf: 'flex-start' })}
          >
            {busy ? 'Working…' : 'Add attachment'}
          </button>
        </>
      )}

      {error && (
        <span role="alert" style={{ font: ctlFont, color: '#c0392b' }}>
          {error}
        </span>
      )}
    </div>
  )
}
