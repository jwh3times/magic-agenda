/** Chromium's install prompt event. It isn't in the DOM types because it isn't a standard. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<unknown>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export interface InstallPromptState {
  /** The browser has offered its install prompt and it hasn't been used yet. */
  promptAvailable: boolean
  /**
   * The person accepted the prompt or the browser reported the app installed, in this tab, which is
   * still a browser tab. Accepting counts because the install has begun and no event reports one
   * that fails.
   */
  justInstalled: boolean
}

export interface InstallPrompt {
  subscribe: (listener: () => void) => () => void
  getSnapshot: () => InstallPromptState
  /** Show the browser's prompt. Call it from a press: browsers refuse one with no user gesture. */
  install: () => Promise<void>
}

/**
 * `beforeinstallprompt` fires once and can arrive before anything that uses it has rendered, so
 * this listens from startup and holds the event. An event works only once, so it is given up as
 * soon as it's used, and the browser sends another if it will offer again.
 */
export function createInstallPrompt(target: EventTarget): InstallPrompt {
  let held: BeforeInstallPromptEvent | null = null
  let state: InstallPromptState = { promptAvailable: false, justInstalled: false }
  const listeners = new Set<() => void>()

  const publish = (next: Partial<InstallPromptState>) => {
    state = { ...state, ...next }
    listeners.forEach((listener) => listener())
  }

  target.addEventListener('beforeinstallprompt', (event) => {
    // Without this, the browser may show a banner of its own instead of leaving it to the button.
    event.preventDefault()
    held = event as BeforeInstallPromptEvent
    publish({ promptAvailable: true })
  })
  target.addEventListener('appinstalled', () => {
    held = null
    publish({ promptAvailable: false, justInstalled: true })
  })

  return {
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getSnapshot: () => state,
    install: async () => {
      if (!held) return
      const event = held
      held = null
      publish({ promptAvailable: false })
      try {
        await event.prompt()
        const { outcome } = await event.userChoice
        if (outcome === 'accepted') publish({ justInstalled: true })
      } catch {
        // Refused, which leaves the written steps showing, and they still work.
      }
    },
  }
}

// Listening starts when this module loads, so `main.tsx` imports it before anything renders.
export const browserInstallPrompt = createInstallPrompt(window)
