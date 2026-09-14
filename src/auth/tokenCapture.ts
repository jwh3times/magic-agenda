interface AuthTokenCapture {
  read(): string | null
  consume(): void
}

declare global {
  interface Window {
    __magicAgendaAuthTokenCapture?: AuthTokenCapture
  }
}

/**
 * Reads an emailed token from a query string. Supabase emits `token_hash`, but an explicitly empty
 * value is not a usable token and must behave exactly like an absent parameter.
 */
export function readTokenHash(search: string): string | null {
  const raw = new URLSearchParams(search).get('token_hash')
  return raw ? raw : null
}

/** Idempotent so React StrictMode may evaluate a state initializer twice without losing the token. */
export function readCapturedAuthToken(): string | null {
  return window.__magicAgendaAuthTokenCapture?.read() ?? null
}

/** Prevents a later client-side visit from replaying the token captured for the current mount. */
export function consumeCapturedAuthToken(): void {
  window.__magicAgendaAuthTokenCapture?.consume()
}
