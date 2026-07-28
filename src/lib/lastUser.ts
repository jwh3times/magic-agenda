// The last signed-in user id, mirrored out of the session so an offline boot knows whose
// snapshot to read. Not a credential and not trusted for authorization — RLS is still the
// only authorization boundary, and every request offline fails anyway.
const KEY = 'ma-last-user'

export function readLastUserId(): string {
  try {
    return localStorage.getItem(KEY) ?? ''
  } catch {
    return ''
  }
}

export function writeLastUserId(id: string): void {
  try {
    localStorage.setItem(KEY, id)
  } catch {
    // ignore
  }
}

export function clearLastUserId(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // ignore
  }
}
