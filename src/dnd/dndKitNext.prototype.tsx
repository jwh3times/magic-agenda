/**
 * PROTOTYPE — do not import from production.
 *
 * This compiles the current board seam against dnd-kit's successor 0.5.0 packages. It exists to
 * answer whether the new event, sensor, sortable, droppable, collision, and overlay APIs can feed
 * the unchanged resolveDrop/reorder modules. The interactive production board still uses the
 * legacy adapter until the pointer behavior is verified on real mouse and touch hardware.
 */
import { useRef, useState, type ComponentProps, type ReactNode } from 'react'
import {
  DragDropProvider,
  DragOverlay,
  useDroppable,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/react'
import { useSortable } from '@dnd-kit/react/sortable'
import { PointerActivationConstraints, PointerSensor } from '@dnd-kit/dom'
import { OptimisticSortingPlugin } from '@dnd-kit/dom/sortable'
import { closestCorners } from '@dnd-kit/collision'
import { NO_RECUR, type Task, type ViewName, type WorkflowStatus } from '../types/task'
import type { Mode } from './reorder'
import {
  beginDrag,
  modeForView,
  resolveDrop,
  type DragPhase,
  type DragSession,
  type DropInput,
  type RectLike,
} from './resolveDrop'

type PersistReorder = (next: Task[], containers: string[], mode: Mode) => void | Promise<void>
type PreviewReorder = (next: Task[]) => void
type ProviderSensors = NonNullable<ComponentProps<typeof DragDropProvider>['sensors']>

const sensors: ProviderSensors = (defaults) => [
  // Keep the default keyboard sensor. Only replace the pointer sensor so mouse and touch retain
  // the board's existing activation rules.
  ...defaults.filter((sensor) => sensor !== PointerSensor),
  PointerSensor.configure({
    activationConstraints(event) {
      return event.pointerType === 'touch'
        ? [new PointerActivationConstraints.Delay({ value: 250, tolerance: { x: 8, y: 8 } })]
        : [new PointerActivationConstraints.Distance({ value: 6 })]
    },
  }),
]

function rectOf(shape: { boundingRectangle: RectLike } | null | undefined): RectLike | null {
  if (!shape) return null
  const { top, height } = shape.boundingRectangle
  return { top, height }
}

/** The successor event-shape adapter; resolveDrop stays vendor-free and unchanged. */
// oxlint-disable-next-line react/only-export-components -- focused prototype exports its adapter
export function nextDropInput(event: DragOverEvent | DragEndEvent, phase: DragPhase): DropInput {
  const { operation } = event
  return {
    phase,
    overId: operation.target ? String(operation.target.id) : null,
    activeRect: rectOf(operation.shape?.current),
    overRect: rectOf(operation.target?.shape),
    now: new Date().toISOString(),
  }
}

/**
 * A compile-checked successor adapter with the same persistence contract as useBoardDnd.
 * Canceled drags are folded into onDragEnd by the new API.
 */
// oxlint-disable-next-line react/only-export-components -- focused prototype exports its adapter hook
export function useDndKitNextPrototype(
  view: ViewName,
  tasks: Task[],
  previewReorder: PreviewReorder,
  persistReorder: PersistReorder,
) {
  const [activeId, setActiveId] = useState<string | null>(null)
  const [activeWidth, setActiveWidth] = useState<number | undefined>()
  const session = useRef<DragSession | null>(null)
  const mode = modeForView(view)

  const reset = () => {
    setActiveId(null)
    setActiveWidth(undefined)
    session.current = null
  }

  const onDragStart = (event: DragStartEvent) => {
    const { source, shape } = event.operation
    if (!source) return
    const id = String(source.id)
    setActiveId(id)
    setActiveWidth(shape?.initial.boundingRectangle.width)
    session.current = beginDrag(tasks, id, mode)
  }

  const onDragOver = (event: DragOverEvent) => {
    if (!session.current) return
    const step = resolveDrop(session.current, tasks, nextDropInput(event, 'hover'))
    if (!step) return
    session.current = step.session
    previewReorder(step.tasks)
  }

  const onDragEnd = (event: DragEndEvent) => {
    const current = session.current
    if (current && !event.canceled) {
      const step = resolveDrop(current, tasks, nextDropInput(event, 'drop'))
      const settled = step?.session ?? current
      if (settled.didMove) {
        void persistReorder(step?.tasks ?? tasks, [...settled.touched], settled.mode)
      }
    }
    reset()
  }

  return {
    providerProps: { sensors, onDragStart, onDragOver, onDragEnd },
    activeTask: tasks.find((task) => task.id === activeId) ?? null,
    activeWidth,
  }
}

/** Empty lanes remain registered targets; SortableContext is gone in the successor API. */
export function DndKitNextDropLane({ id, children }: { id: string; children: ReactNode }) {
  const { ref } = useDroppable({ id, collisionDetector: closestCorners })
  return <div ref={ref}>{children}</div>
}

/**
 * The new sortable requires an explicit lane group and index. Its optimistic sorting plugin is
 * removed because Magic Agenda previews cross-lane moves through resolveDrop and deliberately
 * does not shuffle neighbours while hovering.
 */
/* oxlint-disable react/refs -- dnd-kit 0.5 exposes sortable state as render-time getters */
export function DndKitNextSortable({
  id,
  group,
  index,
  disabled,
  children,
}: {
  id: string
  group: string
  index: number
  disabled: boolean
  children: ReactNode
}) {
  const sortable = useSortable({
    id,
    group,
    index,
    disabled,
    collisionDetector: closestCorners,
    plugins: (defaults) => defaults.filter((plugin) => plugin !== OptimisticSortingPlugin),
  })

  return (
    <div ref={sortable.ref} style={{ touchAction: 'manipulation' }}>
      <div style={{ opacity: sortable.isDragging ? 0.35 : 1 }}>{children}</div>
    </div>
  )
}
/* oxlint-enable react/refs */

/** One overlay per provider, using the successor render-prop source. */
export function DndKitNextShell({ children }: { children: ReactNode }) {
  return (
    <DragDropProvider sensors={sensors}>
      {children}
      <DragOverlay>{(source) => <div>Dragging {String(source.id)}</div>}</DragOverlay>
    </DragDropProvider>
  )
}

const demoTasks: Task[] = [
  {
    id: 'alpha',
    title: 'Inbox task',
    description: '',
    labelId: null,
    color: 'yellow',
    checklist: [],
    status: 'todo',
    completedAt: null,
    reopenStatus: 'todo',
    archivedAt: null,
    day: 'inbox',
    atTime: null,
    pinned: false,
    order: 0,
    korder: 0,
    ...NO_RECUR,
  },
  {
    id: 'bravo',
    title: 'Existing task',
    description: '',
    labelId: null,
    color: 'blue',
    checklist: [],
    status: 'doing',
    completedAt: null,
    reopenStatus: 'doing',
    archivedAt: null,
    day: '2026-07-01',
    atTime: null,
    pinned: false,
    order: 0,
    korder: 0,
    ...NO_RECUR,
  },
]

const dayLanes = ['inbox', '2026-07-01', '2026-07-02']
const statusLanes: WorkflowStatus[] = ['todo', 'doing', 'completed']

/**
 * A live, throwaway harness for browser-testing the published successor runtime. It deliberately
 * uses plain cards rather than production UI so this file cannot become a shadow implementation.
 */
export function DndKitNextRuntimePrototype() {
  const [tasks, setTasks] = useState(demoTasks)
  const [view, setView] = useState<'calendar' | 'kanban'>('calendar')
  const [filtered, setFiltered] = useState(false)
  const [persisted, setPersisted] = useState('none')
  const { providerProps, activeTask, activeWidth } = useDndKitNextPrototype(
    view,
    tasks,
    setTasks,
    (next, containers, mode) => {
      setTasks(next)
      setPersisted(`${mode}: ${containers.join(' -> ')}`)
    },
  )
  const lanes = view === 'kanban' ? statusLanes : dayLanes
  const laneOf = (task: Task) => (view === 'kanban' ? task.status : task.day)
  const orderOf = (task: Task) => (view === 'kanban' ? task.korder : task.order)

  return (
    <main style={{ fontFamily: 'system-ui', maxWidth: 920, margin: '0 auto', padding: 24 }}>
      <h1>dnd-kit 0.5 live runtime prototype</h1>
      <p>
        Drag across lanes with a mouse, or long-press for 250 ms on touch. Search mode keeps the
        provider mounted but disables each sortable.
      </p>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button onClick={() => setView(view === 'calendar' ? 'kanban' : 'calendar')}>
          Switch to {view === 'calendar' ? 'kanban' : 'calendar'}
        </button>
        <button onClick={() => setFiltered((value) => !value)}>
          Search filter: {filtered ? 'on' : 'off'}
        </button>
        <button
          onClick={() => {
            setTasks(demoTasks)
            setPersisted('none')
          }}
        >
          Reset
        </button>
      </div>
      <p data-testid="prototype-state">
        View: {view}; persisted: {persisted}
      </p>
      <DragDropProvider {...providerProps}>
        <div
          style={{ display: 'grid', gridTemplateColumns: `repeat(${lanes.length}, 1fr)`, gap: 12 }}
        >
          {lanes.map((lane) => {
            const laneTasks = tasks
              .filter((task) => laneOf(task) === lane)
              .sort((a, b) => orderOf(a) - orderOf(b))
            return (
              <DndKitNextDropLane key={lane} id={lane}>
                <section
                  data-testid={`lane-${lane}`}
                  style={{
                    minHeight: 180,
                    border: '2px dashed #94a3b8',
                    borderRadius: 10,
                    padding: 10,
                  }}
                >
                  <h2 style={{ fontSize: 16 }}>{lane}</h2>
                  {laneTasks.length === 0 && <em>empty drop target</em>}
                  {laneTasks.map((task, index) => (
                    <DndKitNextSortable
                      key={task.id}
                      id={task.id}
                      group={lane}
                      index={index}
                      disabled={filtered}
                    >
                      <article
                        data-testid={`card-${task.id}`}
                        style={{
                          width: '100%',
                          boxSizing: 'border-box',
                          padding: 14,
                          marginBottom: 8,
                          borderRadius: 8,
                          border: '1px solid #64748b',
                          background: task.color === 'yellow' ? '#fef08a' : '#bfdbfe',
                          cursor: filtered ? 'not-allowed' : 'grab',
                        }}
                      >
                        {task.title}
                      </article>
                    </DndKitNextSortable>
                  ))}
                </section>
              </DndKitNextDropLane>
            )
          })}
        </div>
        <DragOverlay>
          {() =>
            activeTask ? (
              <div
                style={{ width: activeWidth, padding: 14, background: '#fef08a', borderRadius: 8 }}
              >
                {activeTask.title}
              </div>
            ) : null
          }
        </DragOverlay>
      </DragDropProvider>
    </main>
  )
}
