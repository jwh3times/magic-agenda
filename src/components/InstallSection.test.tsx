import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { InstallGuidance } from '../install/guidance'

const h = vi.hoisted(() => ({
  guidance: { kind: 'steps', inAppBrowser: false } as InstallGuidance,
  install: vi.fn(),
}))

vi.mock('../install/useInstallGuidance', () => ({
  useInstallGuidance: () => ({ guidance: h.guidance, install: h.install }),
}))

import { InstallSection } from './InstallSection'

beforeEach(() => {
  h.guidance = { kind: 'steps', inAppBrowser: false }
  h.install.mockReset().mockResolvedValue(undefined)
})

const showing = (guidance: InstallGuidance) => {
  h.guidance = guidance
  return render(<InstallSection />)
}

describe('in the installed app', () => {
  test('says so, and asks for nothing', () => {
    showing({ kind: 'in-installed-app' })

    expect(screen.getByText(/you're using the installed app/i)).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })
})

describe('just after installing from this tab', () => {
  test('says where to find it', () => {
    showing({ kind: 'just-installed' })

    expect(screen.getByText(/magic agenda is installed/i)).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})

describe('when the browser offers its prompt', () => {
  test('the button shows the prompt', async () => {
    showing({ kind: 'prompt' })

    await userEvent.click(screen.getByRole('button', { name: 'Install the app' }))

    expect(h.install).toHaveBeenCalledTimes(1)
  })
})

describe('on iPhone or iPad', () => {
  test('lists Share, Add to Home Screen, and opening it, in that order', () => {
    showing({ kind: 'ios', inAppBrowser: false })

    const steps = within(screen.getByRole('list', { name: /steps/i })).getAllByRole('listitem')
    const texts = steps.map((step) => step.textContent)
    expect(texts[0]).toMatch(/share/i)
    expect(texts[1]).toContain('Add to Home Screen')
    expect(texts[texts.length - 1]).toMatch(/home screen/i)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  test('the pictures are decoration, because the words already name each button', () => {
    const { container } = showing({ kind: 'ios', inAppBrowser: false })

    const pictures = [...container.querySelectorAll('svg')]
    expect(pictures.length).toBeGreaterThan(0)
    for (const picture of pictures) expect(picture).toHaveAttribute('aria-hidden', 'true')
  })

  test('the steps load nothing from anywhere, so they work offline', () => {
    const { container } = showing({ kind: 'ios', inAppBrowser: false })

    expect(container.querySelector('img, image, use, object, iframe')).toBeNull()
  })

  test('sends someone in a built-in browser to their own browser first', () => {
    showing({ kind: 'ios', inAppBrowser: true })

    expect(screen.getByText(/open this page in safari/i)).toBeInTheDocument()
    expect(screen.getByRole('list', { name: /steps/i })).toBeInTheDocument()
  })

  test('says nothing about built-in browsers to someone in Safari', () => {
    showing({ kind: 'ios', inAppBrowser: false })

    expect(screen.queryByText(/open this page in/i)).not.toBeInTheDocument()
  })
})

describe('in any other browser', () => {
  test('gives written steps, with no button', () => {
    showing({ kind: 'steps', inAppBrowser: false })

    expect(screen.getByText(/your browser's menu/i)).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByText(/open this page in/i)).not.toBeInTheDocument()
  })

  test('sends someone in a built-in browser to their own browser first', () => {
    showing({ kind: 'steps', inAppBrowser: true })

    expect(screen.getByText(/open this page in your usual browser/i)).toBeInTheDocument()
  })
})

describe('the words', () => {
  const everyGuidance: InstallGuidance[] = [
    { kind: 'in-installed-app' },
    { kind: 'just-installed' },
    { kind: 'prompt' },
    { kind: 'ios', inAppBrowser: false },
    { kind: 'ios', inAppBrowser: true },
    { kind: 'steps', inAppBrowser: false },
    { kind: 'steps', inAppBrowser: true },
  ]

  test.each(everyGuidance)('never say PWA: %o', (guidance) => {
    const { container } = showing(guidance)
    expect(container.textContent).not.toMatch(/\bPWA\b/i)
  })

  test.each(everyGuidance.filter((guidance) => guidance.kind !== 'ios'))(
    'keep "Add to Home Screen" for the iPhone step: %o',
    (guidance) => {
      const { container } = showing(guidance)
      expect(container.textContent).not.toMatch(/add to home screen/i)
    },
  )
})
