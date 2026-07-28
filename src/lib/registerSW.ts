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
  // Idempotency guard. Its only current call site is a plain function call in main.tsx, at
  // module scope outside the React tree, so React StrictMode's effect double-invocation does not
  // actually apply here — nothing calls this twice today. The guard still earns its keep: it
  // protects any future call from inside a component (where StrictMode WOULD double-invoke it),
  // and it is what makes "call it twice, register once" testable.
  if (registered) return
  // No /sw.js exists outside a production build (`devOptions.enabled` is false — see
  // vite.config.ts), so registering in dev just 404s. Skip it rather than let that reject.
  if (!import.meta.env.PROD) return
  if (!('serviceWorker' in navigator)) return
  registered = true
  navigator.serviceWorker
    .register('/sw.js')
    .then((registration) => {
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
    .catch(() => {
      // Unsupported browser, blocked by policy, a bad scope — none of these should throw an
      // unhandled rejection into the console. The app works fully without a worker; registering
      // one is an enhancement, never a requirement.
    })
}
