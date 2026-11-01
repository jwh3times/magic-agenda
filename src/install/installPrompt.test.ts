import { describe, expect, it, vi } from 'vitest'
import { createInstallPrompt } from './installPrompt'

function promptEvent(outcome: 'accepted' | 'dismissed' = 'accepted') {
  const event = new Event('beforeinstallprompt', { cancelable: true })
  const prompt = vi.fn(() => Promise.resolve())
  Object.assign(event, { prompt, userChoice: Promise.resolve({ outcome }) })
  return { event, prompt }
}

describe('createInstallPrompt', () => {
  it('starts with nothing to offer', () => {
    expect(createInstallPrompt(new EventTarget()).getSnapshot()).toEqual({
      promptAvailable: false,
      justInstalled: false,
    })
  })

  it("holds the browser's event, and stops its own banner, so it can be used later", () => {
    const target = new EventTarget()
    const store = createInstallPrompt(target)
    const { event } = promptEvent()

    target.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(store.getSnapshot().promptAvailable).toBe(true)
  })

  it('tells subscribers when the prompt arrives, and stops when they leave', () => {
    const target = new EventTarget()
    const store = createInstallPrompt(target)
    const listener = vi.fn()
    const leave = store.subscribe(listener)

    target.dispatchEvent(promptEvent().event)
    expect(listener).toHaveBeenCalledTimes(1)

    leave()
    target.dispatchEvent(new Event('appinstalled'))
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('keeps one answer between changes, which useSyncExternalStore requires', () => {
    const store = createInstallPrompt(new EventTarget())
    expect(store.getSnapshot()).toBe(store.getSnapshot())
  })

  it('counts an accepted prompt as installed', async () => {
    const target = new EventTarget()
    const store = createInstallPrompt(target)
    const { event, prompt } = promptEvent('accepted')
    target.dispatchEvent(event)

    await store.install()

    expect(prompt).toHaveBeenCalledTimes(1)
    expect(store.getSnapshot()).toEqual({ promptAvailable: false, justInstalled: true })
  })

  it('gives the prompt up when it is dismissed, because an event works only once', async () => {
    const target = new EventTarget()
    const store = createInstallPrompt(target)
    target.dispatchEvent(promptEvent('dismissed').event)

    await store.install()

    expect(store.getSnapshot()).toEqual({ promptAvailable: false, justInstalled: false })
  })

  it('offers the button again when the browser sends a new prompt after a dismissal', async () => {
    const target = new EventTarget()
    const store = createInstallPrompt(target)
    target.dispatchEvent(promptEvent('dismissed').event)
    await store.install()

    target.dispatchEvent(promptEvent().event)

    expect(store.getSnapshot().promptAvailable).toBe(true)
  })

  it('shows the prompt once however many times the button is pressed', async () => {
    const target = new EventTarget()
    const store = createInstallPrompt(target)
    const { event, prompt } = promptEvent()
    target.dispatchEvent(event)

    await Promise.all([store.install(), store.install()])

    expect(prompt).toHaveBeenCalledTimes(1)
  })

  it('does nothing when there is no prompt to show', async () => {
    const store = createInstallPrompt(new EventTarget())
    await expect(store.install()).resolves.toBeUndefined()
    expect(store.getSnapshot()).toEqual({ promptAvailable: false, justInstalled: false })
  })

  it('falls back when the browser refuses to show the prompt', async () => {
    const target = new EventTarget()
    const store = createInstallPrompt(target)
    const { event, prompt } = promptEvent()
    prompt.mockRejectedValue(new DOMException('no gesture', 'NotAllowedError'))
    target.dispatchEvent(event)

    await expect(store.install()).resolves.toBeUndefined()

    expect(store.getSnapshot()).toEqual({ promptAvailable: false, justInstalled: false })
  })

  it('updates when the browser reports the app installed, however that was started', () => {
    const target = new EventTarget()
    const store = createInstallPrompt(target)
    target.dispatchEvent(promptEvent().event)

    target.dispatchEvent(new Event('appinstalled'))

    expect(store.getSnapshot()).toEqual({ promptAvailable: false, justInstalled: true })
  })
})
