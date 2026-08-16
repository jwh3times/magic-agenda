import { isTemplate, type ChecklistItem, type Task } from '../types/task'
import { newId } from '../lib/id'
import { rowToTask, taskToRow } from './mappers'
import type { Database } from '../types/database.types'

export const EXPORT_VERSION = 1 as const

export interface ExportSettings {
  theme: string
  defaultView: string
  weekStart: number
  timezone: string | null
}

export const LEGACY_CATEGORIES = ['work', 'personal', 'errands', 'ideas', 'health'] as const
export type LegacyCategory = (typeof LEGACY_CATEGORIES)[number]

/**
 * The v1 file task. Category is deliberately confined to this compatibility boundary; the app
 * domain uses nullable `labelId`, while #178 owns the Label-aware v2 export format.
 */
export type LegacyTask = Omit<Task, 'labelId'> & { category: LegacyCategory }

/** The on-disk v1 backup shape. It remains Category-shaped until #178 introduces v2. */
export interface BoardExport {
  version: typeof EXPORT_VERSION
  exportedAt: string
  settings: ExportSettings
  tasks: LegacyTask[]
  templates: LegacyTask[]
}

export function serializeExport(
  tasks: LegacyTask[],
  templates: LegacyTask[],
  settings: ExportSettings,
  exportedAt: string,
): string {
  return JSON.stringify(
    { version: EXPORT_VERSION, exportedAt, settings, tasks, templates },
    null,
    2,
  )
}

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

function isTask(v: unknown): v is LegacyTask {
  if (!v || typeof v !== 'object') return false
  const t = v as LegacyTask
  return (
    typeof t.id === 'string' &&
    typeof t.title === 'string' &&
    typeof t.description === 'string' &&
    (LEGACY_CATEGORIES as readonly string[]).includes(t.category) &&
    (COLORS as readonly string[]).includes(t.color) &&
    (STATUSES as readonly string[]).includes(t.status) &&
    typeof t.done === 'boolean' &&
    typeof t.day === 'string' &&
    typeof t.order === 'number' &&
    typeof t.korder === 'number' &&
    (t.atTime === null || typeof t.atTime === 'string') &&
    typeof t.pinned === 'boolean' &&
    (FREQS as readonly string[]).includes(t.recurFreq) &&
    typeof t.recurInterval === 'number' &&
    (t.recurUntil === null || typeof t.recurUntil === 'string') &&
    (t.recurParentId === null || typeof t.recurParentId === 'string') &&
    // A template (recurFreq !== 'none') has no parent; an instance (recurFreq === 'none') has one
    // (see isTemplate() in types/task.ts). A row that is both recurring AND parented is neither —
    // reject the hybrid rather than let it silently become a broken template or a broken instance.
    (t.recurFreq === 'none' || t.recurParentId === null) &&
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
  tasks: LegacyTask[]
  templates: LegacyTask[]
} {
  const templateIdMap = new Map(data.templates.map((t) => [t.id, newId()]))
  const freshChecklist = (list: ChecklistItem[]) => list.map((c) => ({ ...c, id: newId() }))
  const templates = data.templates.map((t) => ({
    ...t,
    id: templateIdMap.get(t.id)!,
    checklist: freshChecklist(t.checklist),
    recurSkip: [...t.recurSkip],
  }))
  const tasks = data.tasks.map((t) => {
    const parent = t.recurParentId ? (templateIdMap.get(t.recurParentId) ?? null) : null
    return {
      ...t,
      id: newId(),
      checklist: freshChecklist(t.checklist),
      recurParentId: parent,
      recurOriginDay: parent ? t.recurOriginDay : null,
      recurSkip: [...t.recurSkip],
    }
  })
  return { tasks, templates }
}

type TaskRow = Database['public']['Tables']['tasks']['Row']
type TaskInsert = Database['public']['Tables']['tasks']['Insert']

function asLegacyCategory(value: string): LegacyCategory {
  return (LEGACY_CATEGORIES as readonly string[]).includes(value)
    ? (value as LegacyCategory)
    : 'work'
}

/**
 * Current DB row -> v1 file task.
 *
 * A canonical Label assignment wins when its seeded compatibility alias still exists. Unlabeled
 * and an unaliased Label fall back to the physical Category column so v1 remains valid; v1 cannot
 * represent either concept exactly, which is why the Label-aware format is a separate #178 slice.
 */
export function rowToLegacyTask(
  row: TaskRow,
  legacyCategoryByLabelId: ReadonlyMap<string, LegacyCategory>,
): LegacyTask {
  const current = rowToTask(row)
  const { labelId, ...task } = current
  const alias = labelId ? legacyCategoryByLabelId.get(labelId) : undefined
  return { ...task, category: alias ?? asLegacyCategory(row.category) }
}

/**
 * v1 file task -> deploy-window DB insert.
 *
 * `label_assignment_explicit = false` is intentional: the temporary database trigger maps this
 * legacy Category to the selected Board's seeded Label. Every normal app write uses the opposite
 * marker through `taskToRow`, including an explicit null for Unlabeled.
 */
export function legacyTaskToRow(task: LegacyTask, userId: string, boardId: string): TaskInsert {
  const { category, ...legacyTask } = task
  return {
    ...taskToRow({ ...legacyTask, labelId: null }, userId, boardId),
    category,
    label_id: null,
    label_assignment_explicit: false,
  }
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}
