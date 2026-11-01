import { useSyncExternalStore } from 'react'
import { browserPlatform } from '../lib/platform'
import { installGuidance } from './guidance'
import { browserInstallPrompt } from './installPrompt'

/** The current install guidance, and how to show the browser's prompt when it offers one. */
export function useInstallGuidance() {
  const prompt = useSyncExternalStore(
    browserInstallPrompt.subscribe,
    browserInstallPrompt.getSnapshot,
  )
  return {
    guidance: installGuidance({ ...browserPlatform, ...prompt }),
    install: browserInstallPrompt.install,
  }
}
