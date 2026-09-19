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
  /** False for a Viewer, and for a board hydrated from an offline snapshot. */
  canEdit: boolean
  /** The board is being read from a snapshot, so the server cannot be reached at all. */
  offline: boolean
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
 * to attach to until the Task has been saved.
 *
 * **Every attachment is signed at load, not on click.** The bucket is private, so a signed URL is
 * the only way to reach the bytes — and signing on click would put `window.open` after an `await`,
 * which Safari blocks because the call is no longer synchronous with the user's gesture. Worse,
 * `noopener` makes `window.open` return null, so the code could not even tell it had been blocked:
 * the user would click a filename and nothing at all would happen. Signing up front makes these
 * ordinary links, which the browser opens itself.
 */
export function AttachmentsSection({ boardId, taskId, canEdit, offline, chrome }: Props) {
  const [attachments, setAttachments] = useState<Attachment[] | null>(null)
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [brokenThumbs, setBrokenThumbs] = useState<Record<string, true>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  /**
   * A generation counter rather than a local `cancelled` flag.
   *
   * Two things need invalidating and a per-call boolean handles neither: the editor can close
   * mid-request, and a second load can start before the first finishes (upload, then reload). Both
   * would otherwise write stale state over fresh.
   */
  const generation = useRef(0)

  const load = useCallback(async () => {
    const mine = ++generation.current
    try {
      const rows = await listAttachments(taskId)
      if (generation.current !== mine) return
      setAttachments(rows)
      // A previous failure must not leave a red alert standing over a list that loaded fine.
      setError(null)

      const signed = await Promise.all(
        rows.map(async (row) => [row.id, await signedUrl(row.storagePath)] as const),
      )
      if (generation.current !== mine) return
      setUrls(Object.fromEntries(signed.filter(([, url]) => url !== null) as [string, string][]))
    } catch (cause) {
      if (generation.current !== mine) return
      // **Deliberately leaves `attachments` at null.** Setting it to `[]` would render "No
      // attachments yet." beside the error — telling the user there are none when we simply could
      // not find out. Showing the alert alone is the honest pair.
      setError(cause instanceof Error ? cause.message : 'Could not load attachments.')
    }
  }, [taskId])

  useEffect(() => {
    // Offline the board is served from a snapshot and this request can only fail, so do not make
    // it: a raw `FetchError: Failed to fetch` in the editor helps nobody. Derived during render
    // below rather than pushed into state here -- setting state synchronously in an effect is both
    // a lint error and the slower way to say the same thing.
    if (offline) return
    // Fetching the attachment list IS synchronizing with an external system -- the case the rule's
    // own help text carves out. `load` sets state only after its awaits, so there is no cascading
    // render here; the rule cannot see through the async function to tell.
    //
    // Same caveat as `useBoardDirectory`'s identical disable: this blankets an entire async
    // function, so a synchronous setState added to `load`'s pre-await prefix would be silently
    // un-linted. Re-check this reasoning before adding one.
    // oxlint-disable-next-line react/set-state-in-effect
    void load()
    const counter = generation
    return () => {
      counter.current++
    }
  }, [load, offline])

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

  const { fg, sub, fieldBg, border, ctlFont, btn } = chrome

  // Offline is a property of the render, not something to store: there is nothing to load and
  // nothing that could change it but the prop itself.
  const shownError = offline ? 'Attachments are unavailable while this board is offline.' : error
  const shownAttachments = offline ? null : attachments

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span style={{ font: ctlFont, color: sub, fontSize: 11 }}>
        PNG, JPEG, GIF, WebP, PDF · up to {formatFileSize(ATTACHMENT_MAX_BYTES)}
      </span>

      {shownAttachments === null ? (
        // Nothing here when the load failed or we are offline: the alert below is the whole
        // message, and "Loading…" under it would claim a request is still running.
        <span style={{ font: ctlFont, color: sub }}>{shownError ? null : 'Loading…'}</span>
      ) : shownAttachments.length === 0 ? (
        <span style={{ font: ctlFont, color: sub }}>No attachments yet.</span>
      ) : (
        <ul
          style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}
          aria-label="Attachments"
        >
          {shownAttachments.map((attachment) => {
            const url = urls[attachment.id]
            const showThumb =
              isImageMimeType(attachment.mimeType) && url && !brokenThumbs[attachment.id]
            return (
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
                {showThumb ? (
                  <img
                    src={url}
                    alt=""
                    width={36}
                    height={36}
                    // A signed URL can expire, and a network failure or a CSP that has not been
                    // widened will refuse it. Falling back to the placeholder beats a 36px hole
                    // with no text in it, which is what `alt=""` renders.
                    onError={() => setBrokenThumbs((b) => ({ ...b, [attachment.id]: true }))}
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

                <span style={{ flex: 1, minWidth: 0 }}>
                  {url ? (
                    <a
                      href={url}
                      target="_blank"
                      // The URL is a bearer token for the next hour, so the opened document must
                      // not be able to reach back through `window.opener`.
                      rel="noopener noreferrer"
                      style={{ color: fg, display: 'block' }}
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
                    </a>
                  ) : (
                    // No signed URL means the file cannot be opened at all. Say so plainly rather
                    // than offering a link that would do nothing.
                    <span style={{ color: sub, display: 'block' }} title="Could not be opened">
                      {attachment.filename}
                    </span>
                  )}
                  <span style={{ font: ctlFont, color: sub, fontSize: 11 }}>
                    {formatFileSize(attachment.sizeBytes)}
                  </span>
                </span>

                {canEdit && (
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
            )
          })}
        </ul>
      )}

      {canEdit && (
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

      {shownError && (
        <span role="alert" style={{ font: ctlFont, color: '#c0392b' }}>
          {shownError}
        </span>
      )}
    </div>
  )
}
