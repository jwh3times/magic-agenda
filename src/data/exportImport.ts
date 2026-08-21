import { asTask, isTemplate, type ChecklistItem, type Task } from '../types/task'
import { newId } from '../lib/id'
import { taskToRow } from './mappers'
import type { Database } from '../types/database.types'

export const EXPORT_VERSION = 2 as const
const LEGACY_EXPORT_VERSION = 1 as const

export interface ExportLabel {
  id: string
  name: string
  dotColor: string
  position: number
}

export interface ExportSettings {
  theme: string
  defaultView: string
  weekStart: number
  timezone: string | null
}

export const LEGACY_CATEGORIES = ['work', 'personal', 'errands', 'ideas', 'health'] as const
export type LegacyCategory = (typeof LEGACY_CATEGORIES)[number]

/**
 * The on-disk Task, deliberately **not** the app's `Task`.
 *
 * Until #204 they were the same type, so `serializeExport` stringified `Task[]` straight to disk
 * and the file format silently tracked every field rename in `src/types/task.ts`. #204 renamed two
 * recurrence fields to the domain vocabulary (`recurOriginDay` -> `occurrenceDate`, `recurSkip` ->
 * `excludedDates`) and would have invalidated every previously exported v2 file on the way past.
 *
 * The file format is frozen at the names v1 and v2 were written with. This is the same bargain
 * `mappers.ts` makes at the database boundary, for the same reason: an on-disk name is a
 * compatibility contract with files this app no longer controls, and the app domain has to be free
 * to rename without breaking them.
 */
export type ExportTask = Omit<Task, 'occurrenceDate' | 'excludedDates'> & {
  recurOriginDay: string | null
  recurSkip: string[]
}

/** The on-disk v1 Task. Category exists only at this file-format compatibility seam. */
export type LegacyTask = Omit<ExportTask, 'labelId'> & { category: LegacyCategory }

function toExportTask({ occurrenceDate, excludedDates, ...rest }: Task): ExportTask {
  return { ...rest, recurOriginDay: occurrenceDate, recurSkip: excludedDates }
}

function fromExportTask({ recurOriginDay, recurSkip, ...rest }: ExportTask): Task {
  // `asTask`, not a bare object: the file format is flat, so which of the three shapes a row is
  // has to be recovered here rather than trusted from disk.
  return asTask({ ...rest, occurrenceDate: recurOriginDay, excludedDates: recurSkip })
}

interface BoardExportV1 {
  version: typeof LEGACY_EXPORT_VERSION
  exportedAt: string
  settings: ExportSettings
  tasks: LegacyTask[]
  templates: LegacyTask[]
}

export interface BoardExportV2 {
  version: typeof EXPORT_VERSION
  exportedAt: string
  labels: ExportLabel[]
  tasks: ExportTask[]
  templates: ExportTask[]
}

/**
 * The canonical shape consumed by import UI and row planning, regardless of the file version.
 * Account settings deliberately do not cross this seam: v2 does not contain them, and v1 settings
 * are ignored rather than interpreted as authority to overwrite destination Account Preferences.
 */
export interface ImportBundle {
  sourceVersion: typeof LEGACY_EXPORT_VERSION | typeof EXPORT_VERSION
  exportedAt: string
  labels: ExportLabel[]
  tasks: Task[]
  templates: Task[]
}

export function serializeExport(
  tasks: Task[],
  templates: Task[],
  labels: ExportLabel[],
  exportedAt: string,
): string {
  const exportLabels = labels.map(({ id, name, dotColor, position }) => ({
    id,
    name,
    dotColor,
    position,
  }))
  const labelIds = new Set(exportLabels.map((label) => label.id))
  if (
    [...tasks, ...templates].some((task) => task.labelId !== null && !labelIds.has(task.labelId))
  ) {
    // Tasks and Labels are loaded through separate Data API reads. Once management ships, a
    // concurrent vocabulary change can make those reads disagree; emit no corrupt backup.
    throw new Error('A task references a Label that is missing from this export.')
  }
  return JSON.stringify(
    {
      version: EXPORT_VERSION,
      exportedAt,
      labels: exportLabels,
      tasks: tasks.map(toExportTask),
      templates: templates.map(toExportTask),
    },
    null,
    2,
  )
}

const COLORS = ['yellow', 'pink', 'blue', 'mint', 'lilac', 'orange'] as const
const STATUSES = ['todo', 'doing', 'done'] as const
const FREQS = ['none', 'daily', 'weekly', 'monthly'] as const
const HEX_COLOR = /^#[0-9a-f]{6}$/i

const LEGACY_LABELS: readonly ExportLabel[] = [
  { id: 'legacy-category:work', name: 'Work', dotColor: '#2563eb', position: 0 },
  { id: 'legacy-category:personal', name: 'Personal', dotColor: '#db2777', position: 1 },
  { id: 'legacy-category:errands', name: 'Errands', dotColor: '#d97706', position: 2 },
  { id: 'legacy-category:ideas', name: 'Ideas', dotColor: '#7c3aed', position: 3 },
  { id: 'legacy-category:health', name: 'Health', dotColor: '#059669', position: 4 },
]

const LEGACY_LABEL_BY_CATEGORY = new Map(
  LEGACY_CATEGORIES.map((category, index) => [category, LEGACY_LABELS[index]] as const),
)

function isChecklist(value: unknown): value is ChecklistItem[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        !!item &&
        typeof item === 'object' &&
        typeof (item as ChecklistItem).id === 'string' &&
        typeof (item as ChecklistItem).text === 'string' &&
        typeof (item as ChecklistItem).done === 'boolean',
    )
  )
}

function hasTaskFields(value: unknown): value is Omit<ExportTask, 'labelId'> {
  if (!value || typeof value !== 'object') return false
  const task = value as ExportTask
  return (
    typeof task.id === 'string' &&
    typeof task.title === 'string' &&
    typeof task.description === 'string' &&
    (COLORS as readonly string[]).includes(task.color) &&
    (STATUSES as readonly string[]).includes(task.status) &&
    typeof task.done === 'boolean' &&
    typeof task.day === 'string' &&
    typeof task.order === 'number' &&
    typeof task.korder === 'number' &&
    (task.atTime === null || typeof task.atTime === 'string') &&
    typeof task.pinned === 'boolean' &&
    (FREQS as readonly string[]).includes(task.recurFreq) &&
    typeof task.recurInterval === 'number' &&
    (task.recurUntil === null || typeof task.recurUntil === 'string') &&
    (task.recurParentId === null || typeof task.recurParentId === 'string') &&
    // A template has a recurrence rule and no parent. An instance has no rule and a parent. A row
    // carrying both is neither, so reject it rather than importing a broken hybrid.
    (task.recurFreq === 'none' || task.recurParentId === null) &&
    Array.isArray(task.recurSkip) &&
    task.recurSkip.every((day) => typeof day === 'string') &&
    (task.recurOriginDay === null || typeof task.recurOriginDay === 'string') &&
    isChecklist(task.checklist)
  )
}

function isLegacyTask(value: unknown): value is LegacyTask {
  return (
    hasTaskFields(value) &&
    (LEGACY_CATEGORIES as readonly string[]).includes((value as LegacyTask).category)
  )
}

function isV2Task(value: unknown): value is ExportTask {
  if (!hasTaskFields(value)) return false
  const labelId = (value as ExportTask).labelId
  return labelId === null || (typeof labelId === 'string' && labelId.length > 0)
}

function isExportLabel(value: unknown): value is ExportLabel {
  if (!value || typeof value !== 'object') return false
  const label = value as ExportLabel
  return (
    typeof label.id === 'string' &&
    label.id.length > 0 &&
    typeof label.name === 'string' &&
    label.name === label.name.trim() &&
    label.name.length >= 1 &&
    label.name.length <= 80 &&
    typeof label.dotColor === 'string' &&
    HEX_COLOR.test(label.dotColor) &&
    Number.isInteger(label.position) &&
    label.position >= 0
  )
}

function arraysAreSeparated(tasks: ExportTask[], templates: ExportTask[]): boolean {
  return templates.every(isTemplate) && tasks.every((task) => !isTemplate(task))
}

function legacyTaskToCanonical(task: LegacyTask): Task {
  const { category, ...content } = task
  return fromExportTask({ ...content, labelId: LEGACY_LABEL_BY_CATEGORY.get(category)!.id })
}

function parseV1(raw: BoardExportV1): ParseResult {
  if (typeof raw.exportedAt !== 'string') return { ok: false, error: 'Not a Magic Agenda export.' }
  if (!Array.isArray(raw.tasks) || !Array.isArray(raw.templates)) {
    return { ok: false, error: 'Not a Magic Agenda export.' }
  }
  if ([...raw.tasks, ...raw.templates].some((task) => !isLegacyTask(task))) {
    return { ok: false, error: 'The file contains a malformed task.' }
  }
  if (
    !arraysAreSeparated(
      raw.tasks as unknown as ExportTask[],
      raw.templates as unknown as ExportTask[],
    )
  ) {
    return { ok: false, error: 'The file mixes up repeating series and tasks.' }
  }
  return {
    ok: true,
    data: {
      sourceVersion: LEGACY_EXPORT_VERSION,
      exportedAt: raw.exportedAt,
      labels: LEGACY_LABELS.map((label) => ({ ...label })),
      tasks: raw.tasks.map(legacyTaskToCanonical),
      templates: raw.templates.map(legacyTaskToCanonical),
    },
  }
}

function parseV2(raw: BoardExportV2): ParseResult {
  if (typeof raw.exportedAt !== 'string') return { ok: false, error: 'Not a Magic Agenda export.' }
  if (!Array.isArray(raw.labels) || !Array.isArray(raw.tasks) || !Array.isArray(raw.templates)) {
    return { ok: false, error: 'Not a Magic Agenda export.' }
  }
  if (raw.labels.some((label) => !isExportLabel(label))) {
    return { ok: false, error: 'The file contains a malformed Label.' }
  }
  const labelIds = new Set(raw.labels.map((label) => label.id))
  if (labelIds.size !== raw.labels.length) {
    return { ok: false, error: 'The file contains duplicate Label definitions.' }
  }
  if ([...raw.tasks, ...raw.templates].some((task) => !isV2Task(task))) {
    return { ok: false, error: 'The file contains a malformed task.' }
  }
  if (!arraysAreSeparated(raw.tasks, raw.templates)) {
    return { ok: false, error: 'The file mixes up repeating series and tasks.' }
  }
  if (
    [...raw.tasks, ...raw.templates].some(
      (task) => task.labelId !== null && !labelIds.has(task.labelId),
    )
  ) {
    return { ok: false, error: 'The file references a Label definition it does not contain.' }
  }
  return {
    ok: true,
    data: {
      sourceVersion: EXPORT_VERSION,
      exportedAt: raw.exportedAt,
      labels: raw.labels.map((label) => ({ ...label })),
      tasks: raw.tasks.map(fromExportTask),
      templates: raw.templates.map(fromExportTask),
    },
  }
}

export type ParseResult = { ok: true; data: ImportBundle } | { ok: false; error: string }

/** Hand-rolled validation with an explicit compatibility path. Rejects malformed input. */
export function parseExport(json: string): ParseResult {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    return { ok: false, error: 'Not a valid JSON file.' }
  }
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'Not a Magic Agenda export.' }
  const version = (raw as { version?: unknown }).version
  if (version === LEGACY_EXPORT_VERSION) return parseV1(raw as BoardExportV1)
  if (version === EXPORT_VERSION) return parseV2(raw as BoardExportV2)
  return { ok: false, error: 'Unsupported export version — export again from the current app.' }
}

/** Source Label definitions that at least one imported Task or Series actually references. */
export function referencedSourceLabels(data: ImportBundle): ExportLabel[] {
  const referenced = new Set(
    [...data.templates, ...data.tasks]
      .map((task) => task.labelId)
      .filter((id): id is string => id !== null),
  )
  return data.labels.filter((label) => referenced.has(label.id))
}

/**
 * Fresh ids for everything, preserving template↔instance links and checklist content. An instance
 * whose template is missing from the file becomes a plain Task.
 *
 * Checklist Step ids are remapped through **one** map for the whole bundle, not freshened per task.
 * A Step keeps one identity across its Series (#214) — that shared id is what lets an all-future
 * Checklist edit carry each Occurrence's Step Completion across — so minting per task would sever
 * every imported Series' Steps from its Occurrences'. Two unrelated Tasks that shared a Step id in
 * the file still share one afterwards, which is harmless: Steps are only ever reconciled between a
 * Series and its own Occurrences.
 */
export function remapIds(data: Pick<ImportBundle, 'tasks' | 'templates'>): {
  tasks: Task[]
  templates: Task[]
} {
  const templateIdMap = new Map(data.templates.map((task) => [task.id, newId()]))
  const stepIdMap = new Map<string, string>()
  const freshChecklist = (list: ChecklistItem[]) =>
    list.map((item) => {
      const mapped = stepIdMap.get(item.id) ?? newId()
      stepIdMap.set(item.id, mapped)
      return { ...item, id: mapped }
    })
  const templates = data.templates.map((task) => ({
    ...task,
    id: templateIdMap.get(task.id)!,
    checklist: freshChecklist(task.checklist),
    excludedDates: [...task.excludedDates],
  }))
  const tasks = data.tasks.map((task) => {
    const parent = task.recurParentId ? (templateIdMap.get(task.recurParentId) ?? null) : null
    return asTask({
      ...task,
      id: newId(),
      checklist: freshChecklist(task.checklist),
      recurParentId: parent,
      occurrenceDate: parent ? task.occurrenceDate : null,
      excludedDates: [...task.excludedDates],
    })
  })
  return { tasks, templates }
}

export type ImportTaskRow = Database['public']['Tables']['tasks']['Insert']

export interface ImportPlan {
  taskRows: ImportTaskRow[]
  templateRows: ImportTaskRow[]
}

export type PrepareImportResult = { ok: true; data: ImportPlan } | { ok: false; error: string }

/**
 * Validate explicit source→destination Label choices, apply them, freshen all identities, and plan
 * destination-scoped inserts. No name matching and no Label creation occur anywhere in this path.
 */
export function prepareImport(
  data: ImportBundle,
  mapping: ReadonlyMap<string, string | null>,
  destinationLabelIds: ReadonlySet<string>,
  boardId: string,
): PrepareImportResult {
  const required = referencedSourceLabels(data)
  if (required.some((label) => !mapping.has(label.id))) {
    return { ok: false, error: 'Choose a destination for every source Label.' }
  }
  if (
    required.some((label) => {
      const destination = mapping.get(label.id)
      return destination !== null && !destinationLabelIds.has(destination!)
    })
  ) {
    return { ok: false, error: 'A chosen destination Label is no longer available.' }
  }

  const applyMapping = (task: Task): Task => ({
    ...task,
    labelId: task.labelId === null ? null : mapping.get(task.labelId)!,
  })
  const remapped = remapIds({
    tasks: data.tasks.map(applyMapping),
    templates: data.templates.map(applyMapping),
  })
  return {
    ok: true,
    data: {
      taskRows: remapped.tasks.map((task) => taskToRow(task, boardId)),
      templateRows: remapped.templates.map((task) => taskToRow(task, boardId)),
    },
  }
}

export function chunk<T>(items: T[], size: number): T[][] {
  const output: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    output.push(items.slice(index, index + size))
  }
  return output
}
