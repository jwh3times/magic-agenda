import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router'
import { beforeEach, expect, test, vi } from 'vitest'
import type { InstallGuidance } from '../install/guidance'
import { ThemeProvider } from '../theme/ThemeProvider'

const h = vi.hoisted(() => ({
  guidance: { kind: 'steps', inAppBrowser: false } as InstallGuidance,
  install: vi.fn(),
}))

vi.mock('../install/useInstallGuidance', () => ({
  useInstallGuidance: () => ({ guidance: h.guidance, install: h.install }),
}))

import { InstallBanner } from './InstallBanner'

function WhereAmI() {
  const location = useLocation()
  const where = { pathname: location.pathname, state: location.state as unknown }
  return <output aria-label="location">{JSON.stringify(where)}</output>
}

const showing = (guidance: InstallGuidance) => {
  h.guidance = guidance
  return render(
    <MemoryRouter>
      <ThemeProvider initial="cork">
        <InstallBanner />
        <WhereAmI />
      </ThemeProvider>
    </MemoryRouter>,
  )
}

const banner = () => screen.queryByRole('region', { name: 'Install the app' })

beforeEach(() => {
  h.install.mockReset().mockResolvedValue(undefined)
})

test('the browser offering its prompt gets the button, which shows the prompt', async () => {
  showing({ kind: 'prompt' })

  await userEvent.click(screen.getByRole('button', { name: 'Install the app' }))

  expect(h.install).toHaveBeenCalledTimes(1)
  expect(screen.queryByRole('link', { name: 'See how' })).not.toBeInTheDocument()
})

test.each<[string, InstallGuidance]>([
  ['iPhone or iPad', { kind: 'ios', inAppBrowser: false }],
  ['any other browser', { kind: 'steps', inAppBrowser: false }],
  ["another app's built-in browser", { kind: 'steps', inAppBrowser: true }],
])('%s gets a route to the steps in Settings', async (_name, guidance) => {
  showing(guidance)
  expect(screen.queryByRole('button', { name: 'Install the app' })).not.toBeInTheDocument()

  await userEvent.click(screen.getByRole('link', { name: 'See how' }))

  expect(screen.getByRole('status', { name: 'location' })).toHaveTextContent(
    JSON.stringify({ pathname: '/settings', state: { section: 'install' } }),
  )
})

test.each<[string, InstallGuidance]>([
  ['the installed app', { kind: 'in-installed-app' }],
  ['an install that just finished', { kind: 'just-installed' }],
])('%s shows nothing', (_name, guidance) => {
  showing(guidance)

  expect(banner()).not.toBeInTheDocument()
})

test('accepting the prompt takes the banner away', () => {
  const { rerender } = showing({ kind: 'prompt' })
  expect(banner()).toBeInTheDocument()

  h.guidance = { kind: 'just-installed' }
  rerender(
    <MemoryRouter>
      <ThemeProvider initial="cork">
        <InstallBanner />
      </ThemeProvider>
    </MemoryRouter>,
  )

  expect(banner()).not.toBeInTheDocument()
})

test('dismissing it holds for the next visit', async () => {
  const first = showing({ kind: 'steps', inAppBrowser: false })

  await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }))

  expect(banner()).not.toBeInTheDocument()
  first.unmount()
  showing({ kind: 'steps', inAppBrowser: false })
  expect(banner()).not.toBeInTheDocument()
})

test('it still works when storage refuses, for as long as the page is open', async () => {
  const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('blocked')
  })
  showing({ kind: 'steps', inAppBrowser: false })

  await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }))

  expect(banner()).not.toBeInTheDocument()
  setItem.mockRestore()
})

test('it is not a dialog, so the Board stays usable behind it', () => {
  showing({ kind: 'prompt' })

  expect(banner()).toBeInTheDocument()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})
