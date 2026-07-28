import { useEffect, useState } from 'react'
import { applyUpdate, onUpdateReady } from '../lib/registerSW'
import { Toast } from './Toast'

/** Offers the newly-installed version. Never reloads on its own — a board that refreshes
 *  itself mid-drag is worse than a stale one. */
export function UpdatePrompt() {
  const [ready, setReady] = useState(false)
  useEffect(() => onUpdateReady(() => setReady(true)), [])
  if (!ready) return null
  return (
    <Toast
      tone="info"
      message="A new version of Magic Agenda is available."
      action={{ label: 'Refresh', onClick: applyUpdate }}
      duration={20000}
      onDismiss={() => setReady(false)}
    />
  )
}
