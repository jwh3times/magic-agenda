import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import type { ThemeName } from '../types/task'
import { ThemeProvider } from '../theme/ThemeProvider'
import { OfflineBanner } from './OfflineBanner'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function renderBanner({
  reason = 'network',
  savedAt = Date.parse('2026-09-02T15:45:00Z'),
  theme = 'cork',
  timezone = 'UTC',
}: {
  reason?: 'network' | 'auth' | 'request-error'
  savedAt?: number
  theme?: ThemeName
  timezone?: string | null
} = {}) {
  return render(
    <ThemeProvider initial={theme}>
      <OfflineBanner reason={reason} savedAt={savedAt} timezone={timezone} />
    </ThemeProvider>,
  )
}

test('an authentication failure is not presented as offline', () => {
  renderBanner({ reason: 'auth' })
  expect(screen.getByRole('status')).toHaveTextContent(/access couldn’t be verified/i)
  expect(screen.getByRole('status')).not.toHaveTextContent(/offline/i)
})

test('a snapshot from another day names its date in the configured timezone', () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-02T12:00:00Z'))
  renderBanner({ savedAt: Date.parse('2026-08-30T15:45:00Z'), timezone: 'UTC' })
  expect(screen.getByRole('status')).toHaveTextContent(/Aug 30, 2026/i)
})

test('a directory-only fallback honestly handles an unavailable snapshot time', () => {
  renderBanner({ savedAt: Number.NaN })
  expect(screen.getByRole('status')).toHaveTextContent(/last saved board/i)
})

test('the banner uses the active theme instead of a fixed palette and font', () => {
  renderBanner({ theme: 'cork' })
  const cork = screen.getByRole('status')
  const corkBackground = cork.style.background
  const corkFont = cork.style.fontFamily
  cleanup()

  renderBanner({ theme: 'glass' })
  const glass = screen.getByRole('status')
  expect(glass.style.background).not.toBe(corkBackground)
  expect(glass.style.fontFamily).not.toBe(corkFont)
})
