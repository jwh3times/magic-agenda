// Per-device memory of which Board was open (localStorage: survives a new tab, unlike the
// per-tab view in lib/viewStorage.ts). Deliberately the same read/write/clear shape as that
// module, and cleared from the same SIGNED_OUT block, because the two answer the same kind of
// question — what this device had open — and both must stop answering it at sign-out.
//
// A Board id grants nothing on its own, and `resolveSelection` falls back when the remembered id
// is absent from the next account's list. It is swept anyway: "everything, on sign-out" is the
// entire justification for keeping any of this at rest (see data/snapshot.ts), and an exception
// that is only harmless-in-practice erodes the premise the rest of it rests on.
const KEY = 'ma-selected-board'

export function readRememberedBoard(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

export function writeRememberedBoard(boardId: string | null): void {
  try {
    if (boardId) localStorage.setItem(KEY, boardId)
    else localStorage.removeItem(KEY)
  } catch {
    // best-effort, like every other storage access here
  }
}

export function clearRememberedBoard(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // ignore
  }
}
