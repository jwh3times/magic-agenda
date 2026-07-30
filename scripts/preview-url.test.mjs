import { describe, expect, test } from 'vitest'
import {
  CLOUDFLARE_CHECK_NAME,
  findCloudflareCheckRun,
  previewUrlFromDetailsUrl,
} from './preview-url.mjs'

// A real details_url, copied verbatim from PR #115's Cloudflare Pages check run.
const REAL =
  'https://dash.cloudflare.com/?to=/dc85636638435653f1404d0dbfc8ad76/pages/view/magic-agenda/15aaf5a2-379b-41c1-a55c-d6a4ece71cef'

describe('findCloudflareCheckRun', () => {
  test('finds the run by its exact name', () => {
    const runs = [{ name: 'Test' }, { name: CLOUDFLARE_CHECK_NAME, id: 7 }, { name: 'Build' }]
    expect(findCloudflareCheckRun(runs)?.id).toBe(7)
  })

  test('returns null when absent, so the caller can keep polling', () => {
    expect(findCloudflareCheckRun([{ name: 'Test' }])).toBeNull()
  })

  test('tolerates junk rather than throwing mid-poll', () => {
    expect(findCloudflareCheckRun(undefined)).toBeNull()
    expect(findCloudflareCheckRun([null, { name: 'Test' }])).toBeNull()
  })
})

describe('previewUrlFromDetailsUrl', () => {
  test('derives the preview from the deployment UUID', () => {
    expect(previewUrlFromDetailsUrl(REAL, 'magic-agenda')).toBe(
      'https://15aaf5a2.magic-agenda.pages.dev',
    )
  })

  test('lower-cases the prefix, because hostnames are case-insensitive but ugly', () => {
    const upper = REAL.replace('15aaf5a2', '15AAF5A2')
    expect(previewUrlFromDetailsUrl(upper, 'magic-agenda')).toBe(
      'https://15aaf5a2.magic-agenda.pages.dev',
    )
  })

  test('returns null when the URL carries no UUID', () => {
    // If Cloudflare ever changes details_url, this is the branch that fires -- and the CLI turns
    // it into a loud failure rather than testing the wrong site.
    expect(previewUrlFromDetailsUrl('https://dash.cloudflare.com/', 'magic-agenda')).toBeNull()
    expect(previewUrlFromDetailsUrl(undefined, 'magic-agenda')).toBeNull()
    expect(previewUrlFromDetailsUrl('', 'magic-agenda')).toBeNull()
  })
})
