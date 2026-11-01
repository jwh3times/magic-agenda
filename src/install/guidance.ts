import type { Platform } from '../lib/platform'
import type { InstallPromptState } from './installPrompt'

export type InstallFacts = Platform & InstallPromptState

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
