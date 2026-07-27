// Registration lives here rather than in vite-plugin-pwa's injected snippet, which is an
// INLINE script that our script-src 'self' CSP blocks — and keeping it explicit means the
// update handshake is readable code rather than plugin configuration.

let registered = false
let waitingWorker: ServiceWorker | null = null
const listeners = new Set<() => void>()

function announce(worker: ServiceWorker) {
  waitingWorker = worker
  for (const cb of listeners) cb()
}

/** Subscribe to "a new version is installed and waiting". Returns an unsubscribe. */
export function onUpdateReady(cb: () => void): () => void {
  listeners.add(cb)
  if (waitingWorker) cb()
  return () => listeners.delete(cb)
}

/** Activate the waiting worker and reload once it takes control. */
export function applyUpdate(): void {
  const worker = waitingWorker
  if (!worker) return
  navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), {
    once: true,
  })
  worker.postMessage({ type: 'SKIP_WAITING' })
}

export function registerServiceWorker(): void {
  // React StrictMode double-invokes effects in development; registering twice is harmless
  // but noisy, and the guard also makes the behaviour testable.
  if (registered) return
  if (!('serviceWorker' in navigator)) return
  registered = true
  void navigator.serviceWorker.register('/sw.js').then((registration) => {
    if (registration.waiting) announce(registration.waiting)
    registration.addEventListener('updatefound', () => {
      const installing = registration.installing
      if (!installing) return
      installing.addEventListener('statechange', () => {
        // `controller` is null on the very first install — that is not an update, it is the
        // worker taking over for the first time, and prompting for it would be nonsense.
        if (installing.state === 'installed' && navigator.serviceWorker.controller) {
          announce(installing)
        }
      })
    })
  })
}
