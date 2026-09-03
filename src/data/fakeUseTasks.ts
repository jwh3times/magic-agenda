import type { UseTasks } from './useTasks'

const noOp = () => {}
const noOpAsync = async () => {}

/** In-memory useTasks adapter for tests that exercise a caller rather than the Supabase hook. */
export function fakeUseTasks(overrides: Partial<UseTasks> = {}): UseTasks {
  return {
    tasks: [],
    loading: false,
    error: null,
    clearError: noOp,
    reload: noOpAsync,
    previewReorder: noOp,
    createTask: noOpAsync,
    updateTask: noOpAsync,
    removeTask: noOpAsync,
    toggleDone: noOpAsync,
    persistReorder: noOpAsync,
    rollForward: noOpAsync,
    getTemplate: () => undefined,
    saveTask: noOpAsync,
    deleteTask: noOpAsync,
    offline: false,
    fallbackReason: null,
    savedAt: null,
    ...overrides,
  }
}
