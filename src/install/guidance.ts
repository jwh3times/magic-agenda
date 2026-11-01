import type { Platform } from '../lib/platform'

export interface InstallFacts extends Platform {
  /** The browser has offered its install prompt and it hasn't been used yet. */
  promptAvailable: boolean
  /** The app was installed from this tab, which is still a browser tab. */
  justInstalled: boolean
}

export type InstallGuidance =
  | { kind: 'in-installed-app' }
  | { kind: 'just-installed' }
  | { kind: 'prompt' }
  | { kind: 'ios'; inAppBrowser: boolean }
  | { kind: 'steps'; inAppBrowser: boolean }

/** What to tell this person about installing the app. */
export function installGuidance(facts: InstallFacts): InstallGuidance {
  if (facts.standalone) return { kind: 'in-installed-app' }
  if (facts.justInstalled) return { kind: 'just-installed' }
  if (facts.promptAvailable) return { kind: 'prompt' }
  const { inAppBrowser } = facts
  return facts.ios ? { kind: 'ios', inAppBrowser } : { kind: 'steps', inAppBrowser }
}
