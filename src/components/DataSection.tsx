import { useRef, useState, type CSSProperties } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { useBoardDirectoryContext, useBoardSession } from '../board/BoardDirectoryProvider'
import { useLabelDirectoryContext } from '../labels/LabelDirectoryProvider'
import {
  chunk,
  parseExport,
  prepareImport,
  referencedSourceLabels,
  serializeExport,
  type ImportBundle,
  type ImportTaskRow,
} from '../data/exportImport'
import { rowToTask } from '../data/mappers'
import { isTemplate } from '../types/task'
import { ymd } from '../lib/dates'

const INSERT_CHUNK = 200
const UNLABELED_MAPPING = 'unlabeled'

/**
 * Prepared, chunked insert batches for one import attempt (templates-before-instances order), plus
 * a cursor into the next not-yet-inserted batch. Computed once per attempt; kept across a failed
 * batch so a retry resumes with the same fresh ids instead of duplicating accepted batches.
 */
interface ImportProgress {
  batches: ImportTaskRow[][]
  cursor: number
  taskCount: number
  templateCount: number
}

/** Settings → Data: one-Board JSON export and additive import with explicit Label mapping. */
export function DataSection() {
  const { user } = useAuth()
  const userId = user?.id ?? ''
  const { selectedBoardId } = useBoardDirectoryContext()
  const { can } = useBoardSession()
  const {
    labels: destinationLabels,
    loading: labelsLoading,
    error: labelsError,
    offline: labelsOffline,
  } = useLabelDirectoryContext()
  const boardId = selectedBoardId ?? ''
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<ImportBundle | null>(null)
  const [labelMapping, setLabelMapping] = useState<Map<string, string | null>>(new Map())
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const resuming = importProgress !== null
  const sourceLabels = pending ? referencedSourceLabels(pending) : []
  const mappingComplete = sourceLabels.every((label) => labelMapping.has(label.id))
  const canImport = Boolean(userId && boardId && can.transferContent)
  const importUnavailable = !canImport || labelsLoading || labelsOffline || Boolean(labelsError)

  const btn = (disabled: boolean): CSSProperties => ({
    alignSelf: 'flex-start',
    padding: '9px 14px',
    borderRadius: 8,
    border: '1px solid currentColor',
    background: 'transparent',
    color: 'inherit',
    fontWeight: 700,
    fontSize: 14,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.55 : 1,
  })

  const exportBoard = async () => {
    if (!can.exportBoard || !boardId) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const [tasksResult, labelsResult] = await Promise.all([
        // Both reads are selected-Board scoped. RLS remains authoritative; `exportBoard` controls
        // the Owner-only affordance defined by the Board capability model.
        supabase.from('tasks').select('*').eq('board_id', boardId),
        supabase
          .from('labels')
          .select('id, board_id, name, dot_color, position')
          .eq('board_id', boardId),
      ])
      if (tasksResult.error || labelsResult.error) {
        setError('Could not load your data. Please try again.')
        return
      }
      const all = (tasksResult.data ?? []).map(rowToTask)
      const json = serializeExport(
        all.filter((task) => !isTemplate(task)),
        all.filter(isTemplate),
        (labelsResult.data ?? []).map((label) => ({
          id: label.id,
          name: label.name,
          dotColor: label.dot_color,
          position: label.position,
        })),
        new Date().toISOString(),
      )
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `magic-agenda-export-${ymd(new Date())}.json`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
      setNotice('Export downloaded.')
    } catch {
      setError('Could not load your data. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const onFile = async (file: File | undefined) => {
    if (!canImport) return
    setError(null)
    setNotice(null)
    setPending(null)
    setLabelMapping(new Map())
    setImportProgress(null)
    if (!file) return
    const parsed = parseExport(await file.text())
    if (!parsed.ok) {
      setError(parsed.error)
      return
    }
    setPending(parsed.data)
  }

  const chooseDestination = (sourceId: string, value: string) => {
    setLabelMapping((current) => {
      const next = new Map(current)
      if (!value) next.delete(sourceId)
      else next.set(sourceId, value === UNLABELED_MAPPING ? null : value)
      return next
    })
  }

  const confirmImport = async () => {
    if (!pending || !canImport || !mappingComplete) return
    setBusy(true)
    setError(null)
    // Plan only on the first attempt. A retry resumes from the stored cursor, preserving the same
    // fresh ids and mapped destination Label ids for batches that already succeeded.
    let progress = importProgress
    if (!progress) {
      const planned = prepareImport(
        pending,
        labelMapping,
        new Set(destinationLabels.map((label) => label.id)),
        boardId,
      )
      if (!planned.ok) {
        setBusy(false)
        setError(planned.error)
        return
      }
      const { taskRows, templateRows } = planned.data
      progress = {
        batches: [...chunk(templateRows, INSERT_CHUNK), ...chunk(taskRows, INSERT_CHUNK)],
        cursor: 0,
        taskCount: taskRows.length,
        templateCount: templateRows.length,
      }
    }
    const { batches, taskCount, templateCount } = progress
    let cursor = progress.cursor
    try {
      for (; cursor < batches.length; cursor++) {
        const { error: insertError } = await supabase.from('tasks').insert(batches[cursor])
        if (insertError) throw new Error(insertError.message)
      }
    } catch {
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
    setLabelMapping(new Map())
    setNotice(
      `Imported ${taskCount} tasks and ${templateCount} repeating series. Open the board to see them.`,
    )
  }

  const exportDisabled = busy || !can.exportBoard || !boardId
  const importFileDisabled = busy || importUnavailable
  const confirmDisabled = busy || importUnavailable || !mappingComplete

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 520 }}>
      <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5 }}>
        Export this Board's tasks, repeating series, and Label definitions as JSON, or import a
        previous export. Account preferences are not included. Import is additive — nothing is
        overwritten, and importing the same file twice creates duplicates.
      </p>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button
          type="button"
          disabled={exportDisabled}
          onClick={() => void exportBoard()}
          style={btn(exportDisabled)}
        >
          Export my data
        </button>
        <button
          type="button"
          disabled={importFileDisabled}
          onClick={() => fileRef.current?.click()}
          style={btn(importFileDisabled)}
        >
          Import from file…
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          aria-label="Import file"
          disabled={importFileDisabled}
          style={{ display: 'none' }}
          onChange={(event) => void onFile(event.target.files?.[0])}
        />
      </div>
      {pending && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13.5 }}>
          <div>
            This file contains {pending.tasks.length} task
            {pending.tasks.length === 1 ? '' : 's'} and {pending.templates.length} repeating series.
          </div>
          {sourceLabels.length > 0 && (
            <fieldset
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                margin: 0,
                padding: 12,
                border: '1px solid currentColor',
                borderRadius: 8,
              }}
            >
              <legend style={{ fontWeight: 700 }}>Map Labels</legend>
              <div style={{ lineHeight: 1.4, opacity: 0.8 }}>
                Choose an existing destination Label or Unlabeled for each source Label. Labels are
                never created or matched automatically by name.
              </div>
              {sourceLabels.map((source) => {
                const selected = labelMapping.has(source.id)
                  ? (labelMapping.get(source.id) ?? UNLABELED_MAPPING)
                  : ''
                return (
                  <label
                    key={source.id}
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: 10,
                      alignItems: 'center',
                    }}
                  >
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 7,
                        flex: '1 1 120px',
                      }}
                    >
                      <span
                        aria-hidden="true"
                        style={{
                          width: 9,
                          height: 9,
                          borderRadius: '50%',
                          background: source.dotColor,
                          flex: '0 0 auto',
                        }}
                      />
                      {source.name}
                    </span>
                    <select
                      aria-label={`Destination for ${source.name}`}
                      value={selected}
                      disabled={busy || resuming}
                      onChange={(event) => chooseDestination(source.id, event.target.value)}
                      style={{
                        fontSize: 16,
                        padding: '7px 9px',
                        minWidth: 0,
                        flex: '1 1 180px',
                      }}
                    >
                      <option value="">Choose destination…</option>
                      <option value={UNLABELED_MAPPING}>Unlabeled</option>
                      {destinationLabels.map((destination) => (
                        <option key={destination.id} value={destination.id}>
                          {destination.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )
              })}
            </fieldset>
          )}
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              type="button"
              disabled={confirmDisabled}
              onClick={() => void confirmImport()}
              style={btn(confirmDisabled)}
            >
              {resuming ? 'Resume import' : 'Import'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setPending(null)
                setLabelMapping(new Map())
                setImportProgress(null)
              }}
              style={btn(busy)}
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
