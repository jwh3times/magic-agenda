import { useRef, useState, type CSSProperties } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { rowToTask, taskToRow } from '../data/mappers'
import {
  chunk,
  parseExport,
  remapIds,
  serializeExport,
  type BoardExport,
} from '../data/exportImport'
import { isTemplate, type Task } from '../types/task'
import { ymd } from '../lib/dates'

const INSERT_CHUNK = 200

/**
 * Remapped, chunked insert batches for one import attempt (templates-before-instances order),
 * plus a cursor into the next not-yet-inserted batch. Computed once per attempt; kept in state
 * across a failed batch so a retry resumes instead of re-remapping (which would re-insert
 * already-succeeded batches under fresh ids and duplicate them).
 */
interface ImportProgress {
  batches: Task[][]
  cursor: number
  taskCount: number
  templateCount: number
}

/** Settings → Data: JSON export (download) and additive import (fresh ids, FK-safe order). */
export function DataSection() {
  const { user } = useAuth()
  const userId = user?.id ?? ''
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<BoardExport | null>(null)
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const resuming = importProgress !== null

  const btn: CSSProperties = {
    alignSelf: 'flex-start',
    padding: '9px 14px',
    borderRadius: 8,
    border: '1px solid currentColor',
    background: 'transparent',
    color: 'inherit',
    fontWeight: 700,
    fontSize: 14,
    cursor: 'pointer',
    opacity: busy ? 0.6 : 1,
  }

  const exportBoard = async () => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const [tasksRes, settingsRes] = await Promise.all([
        supabase.from('tasks').select('*'),
        supabase.from('user_settings').select('*').eq('user_id', userId).maybeSingle(),
      ])
      if (tasksRes.error || settingsRes.error) {
        setError('Could not load your data. Please try again.')
        return
      }
      const all = (tasksRes.data ?? []).map(rowToTask)
      const json = serializeExport(
        all.filter((t) => !isTemplate(t)),
        all.filter(isTemplate),
        {
          theme: settingsRes.data?.theme ?? 'cork',
          defaultView: settingsRes.data?.default_view ?? 'calendar',
        },
        new Date().toISOString(),
      )
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `magic-agenda-export-${ymd(new Date())}.json`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      setNotice('Export downloaded.')
    } catch {
      // Same message as the resolved-`{error}` path — a thrown/rejected load looks
      // identical to the user.
      setError('Could not load your data. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const onFile = async (file: File | undefined) => {
    setError(null)
    setNotice(null)
    setPending(null)
    setImportProgress(null)
    if (!file) return
    const parsed = parseExport(await file.text())
    if (!parsed.ok) {
      setError(parsed.error)
      return
    }
    setPending(parsed.data)
  }

  const confirmImport = async () => {
    if (!pending) return
    setBusy(true)
    setError(null)
    // Remap only on the first attempt for this pending file — a retry after a failed batch
    // resumes from the stored cursor so already-inserted batches are never re-remapped/re-inserted.
    let progress = importProgress
    if (!progress) {
      const { tasks, templates } = remapIds(pending)
      progress = {
        // Templates first: instances reference them by foreign key.
        batches: [...chunk(templates, INSERT_CHUNK), ...chunk(tasks, INSERT_CHUNK)],
        cursor: 0,
        taskCount: tasks.length,
        templateCount: templates.length,
      }
    }
    const { batches, taskCount, templateCount } = progress
    let cursor = progress.cursor
    try {
      for (; cursor < batches.length; cursor++) {
        const { error: err } = await supabase
          .from('tasks')
          .insert(batches[cursor].map((t) => taskToRow(t, userId)))
        if (err) throw new Error(err.message)
      }
    } catch {
      // A throw (rejected promise) must behave identically to a resolved `{ error }`:
      // keep the same batches + failed cursor so "Resume import" can retry without
      // re-remapping (which would re-insert already-succeeded batches under fresh ids).
      setImportProgress({ batches, cursor, taskCount, templateCount })
      setError(
        'Import failed partway — some tasks may have been added; nothing was overwritten. Click Import to resume.',
      )
      return
    } finally {
      setBusy(false)
    }
    setImportProgress(null)
    setPending(null)
    setNotice(
      `Imported ${taskCount} tasks and ${templateCount} repeating series. Open the board to see them.`,
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 460 }}>
      <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5 }}>
        Download everything (tasks, repeating series, settings) as a JSON file, or import a previous
        export. Import is additive — nothing is overwritten, and importing the same file twice
        creates duplicates.
      </p>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button type="button" disabled={busy} onClick={exportBoard} style={btn}>
          Export my data
        </button>
        <button type="button" disabled={busy} onClick={() => fileRef.current?.click()} style={btn}>
          Import from file…
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          aria-label="Import file"
          style={{ display: 'none' }}
          onChange={(e) => void onFile(e.target.files?.[0])}
        />
      </div>
      {pending && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13.5 }}>
          <div>
            This file contains {pending.tasks.length} task
            {pending.tasks.length === 1 ? '' : 's'} and {pending.templates.length} repeating series.
            Import them?
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" disabled={busy} onClick={confirmImport} style={btn}>
              {resuming ? 'Resume import' : 'Import'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setPending(null)
                setImportProgress(null)
              }}
              style={btn}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {notice && <div style={{ color: '#3f9d63', fontSize: 13 }}>{notice}</div>}
      {error && <div style={{ color: '#b42318', fontSize: 13 }}>{error}</div>}
    </div>
  )
}
