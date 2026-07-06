import { isTemplate, type ChecklistItem, type Task } from '../types/task'
import { newId } from '../lib/id'

export const EXPORT_VERSION = 1 as const

export interface ExportSettings {
  theme: string
  defaultView: string
}

/** The on-disk backup shape — app-domain Task objects, never DB rows. */
export interface BoardExport {
  version: typeof EXPORT_VERSION
  exportedAt: string
  settings: ExportSettings
  tasks: Task[]
  templates: Task[]
}

export function serializeExport(
  tasks: Task[],
  templates: Task[],
  settings: ExportSettings,
  exportedAt: string,
): string {
  return JSON.stringify(
    { version: EXPORT_VERSION, exportedAt, settings, tasks, templates },
    null,
    2,
  )
}

const CATEGORIES = ['work', 'personal', 'errands', 'ideas', 'health'] as const
const COLORS = ['yellow', 'pink', 'blue', 'mint', 'lilac', 'orange'] as const
const STATUSES = ['todo', 'doing', 'done'] as const
const FREQS = ['none', 'daily', 'weekly', 'monthly'] as const

function isChecklist(v: unknown): v is ChecklistItem[] {
  return (
    Array.isArray(v) &&
    v.every(
      (c) =>
        !!c &&
        typeof c === 'object' &&
        typeof (c as ChecklistItem).id === 'string' &&
        typeof (c as ChecklistItem).text === 'string' &&
        typeof (c as ChecklistItem).done === 'boolean',
    )
  )
}

function isTask(v: unknown): v is Task {
  if (!v || typeof v !== 'object') return false
  const t = v as Task
  return (
    typeof t.id === 'string' &&
    typeof t.title === 'string' &&
    typeof t.description === 'string' &&
    (CATEGORIES as readonly string[]).includes(t.category) &&
    (COLORS as readonly string[]).includes(t.color) &&
    (STATUSES as readonly string[]).includes(t.status) &&
    typeof t.day === 'string' &&
    typeof t.order === 'number' &&
    typeof t.korder === 'number' &&
    (t.atTime === null || typeof t.atTime === 'string') &&
    typeof t.pinned === 'boolean' &&
    (FREQS as readonly string[]).includes(t.recurFreq) &&
    typeof t.recurInterval === 'number' &&
    (t.recurUntil === null || typeof t.recurUntil === 'string') &&
    (t.recurParentId === null || typeof t.recurParentId === 'string') &&
    Array.isArray(t.recurSkip) &&
    t.recurSkip.every((s) => typeof s === 'string') &&
    (t.recurOriginDay === null || typeof t.recurOriginDay === 'string') &&
    isChecklist(t.checklist)
  )
}

export type ParseResult = { ok: true; data: BoardExport } | { ok: false; error: string }

/** Hand-rolled validation — no schema dependency. Strict on shape; rejects, never repairs. */
export function parseExport(json: string): ParseResult {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    return { ok: false, error: 'Not a valid JSON file.' }
  }
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'Not a Magic Agenda export.' }
  const data = raw as BoardExport
  if (data.version !== EXPORT_VERSION)
    return { ok: false, error: 'Unsupported export version — export again from the current app.' }
  if (!Array.isArray(data.tasks) || !Array.isArray(data.templates))
    return { ok: false, error: 'Not a Magic Agenda export.' }
  if ([...data.tasks, ...data.templates].some((t) => !isTask(t)))
    return { ok: false, error: 'The file contains a malformed task.' }
  if (data.templates.some((t) => !isTemplate(t)) || data.tasks.some(isTemplate))
    return { ok: false, error: 'The file mixes up repeating series and tasks.' }
  return { ok: true, data }
}

/**
 * Fresh ids for everything (safe re-import — the DB unique ids never collide),
 * preserving template↔instance links and checklist content. An instance whose
 * template is missing from the file becomes a plain task.
 */
export function remapIds(data: Pick<BoardExport, 'tasks' | 'templates'>): {
  tasks: Task[]
  templates: Task[]
} {
  const templateIdMap = new Map(data.templates.map((t) => [t.id, newId()]))
  const freshChecklist = (list: ChecklistItem[]) => list.map((c) => ({ ...c, id: newId() }))
  const templates = data.templates.map((t) => ({
    ...t,
    id: templateIdMap.get(t.id)!,
    checklist: freshChecklist(t.checklist),
  }))
  const tasks = data.tasks.map((t) => {
    const parent = t.recurParentId ? (templateIdMap.get(t.recurParentId) ?? null) : null
    return {
      ...t,
      id: newId(),
      checklist: freshChecklist(t.checklist),
      recurParentId: parent,
      recurOriginDay: parent ? t.recurOriginDay : null,
    }
  })
  return { tasks, templates }
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}
