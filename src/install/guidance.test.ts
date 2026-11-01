import { describe, expect, it } from 'vitest'
import { installGuidance, shouldSuggestInstalling, type InstallFacts } from './guidance'

const browser: InstallFacts = {
  standalone: false,
  justInstalled: false,
  promptAvailable: false,
  ios: false,
  inAppBrowser: false,
}

describe('installGuidance', () => {
  it.each<[string, Partial<InstallFacts>, ReturnType<typeof installGuidance>]>([
    ['none of these', {}, { kind: 'steps', inAppBrowser: false }],
    ['a browser offering its prompt', { promptAvailable: true }, { kind: 'prompt' }],
    ['iPhone or iPad', { ios: true }, { kind: 'ios', inAppBrowser: false }],
    ['the installed app', { standalone: true }, { kind: 'in-installed-app' }],
    ['an install just finished', { justInstalled: true }, { kind: 'just-installed' }],
    [
      "another app's built-in browser on iPhone",
      { ios: true, inAppBrowser: true },
      { kind: 'ios', inAppBrowser: true },
    ],
    [
      "another app's built-in browser elsewhere",
      { inAppBrowser: true },
      { kind: 'steps', inAppBrowser: true },
    ],
  ])('answers for %s', (_name, facts, expected) => {
    expect(installGuidance({ ...browser, ...facts })).toEqual(expected)
  })

  it('never asks the installed app to install itself, whatever else is true', () => {
    // A Home Screen app's user agent has no "Safari" token, so it also reads as a built-in browser.
    expect(
      installGuidance({
        standalone: true,
        justInstalled: false,
        promptAvailable: true,
        ios: true,
        inAppBrowser: true,
      }),
    ).toEqual({ kind: 'in-installed-app' })
  })

  it('stops offering the button once the install has happened', () => {
    expect(installGuidance({ ...browser, justInstalled: true, promptAvailable: true })).toEqual({
      kind: 'just-installed',
    })
  })

  it("prefers the browser's own prompt to written steps", () => {
    expect(installGuidance({ ...browser, promptAvailable: true, inAppBrowser: true })).toEqual({
      kind: 'prompt',
    })
  })
})

describe('shouldSuggestInstalling', () => {
  it.each<[string, Partial<InstallFacts>, boolean]>([
    ['a browser offering its prompt', { promptAvailable: true }, true],
    ['iPhone or iPad', { ios: true }, true],
    ['any other browser', {}, true],
    ["another app's built-in browser", { inAppBrowser: true }, true],
    ['the installed app', { standalone: true }, false],
    ['an install just finished', { justInstalled: true }, false],
  ])('answers for %s', (_name, facts, expected) => {
    expect(shouldSuggestInstalling(installGuidance({ ...browser, ...facts }))).toBe(expected)
  })
})
