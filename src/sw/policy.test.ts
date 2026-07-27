import { expect, test } from 'vitest'
import { isCacheFirst, isNavigation, isNeverCached } from './policy'

const APP = 'https://magicagenda.app'

test('Supabase is never cached, over https or wss', () => {
  expect(isNeverCached(new URL('https://abc.supabase.co/rest/v1/tasks?select=*'))).toBe(true)
  expect(isNeverCached(new URL('wss://abc.supabase.co/realtime/v1/websocket'))).toBe(true)
  expect(isNeverCached(new URL('https://supabase.co/anything'))).toBe(true)
})

test('a lookalike host is not treated as Supabase, and is not cached either', () => {
  expect(isNeverCached(new URL('https://notsupabase.co/x'))).toBe(false)
  expect(isCacheFirst(new URL('https://notsupabase.co/x'), APP)).toBe(false)
})

test('Supabase is never cache-first even though it is same-scheme', () => {
  expect(isCacheFirst(new URL('https://abc.supabase.co/rest/v1/tasks'), APP)).toBe(false)
})

test('hashed build assets are cache-first', () => {
  expect(isCacheFirst(new URL(`${APP}/assets/index-B7xK2p.js`), APP)).toBe(true)
  expect(isCacheFirst(new URL(`${APP}/assets/index-9fA1.css`), APP)).toBe(true)
})

test('the HTML shell is not cache-first', () => {
  expect(isCacheFirst(new URL(`${APP}/index.html`), APP)).toBe(false)
  expect(isCacheFirst(new URL(`${APP}/`), APP)).toBe(false)
})

test('Google Fonts are cache-first', () => {
  expect(isCacheFirst(new URL('https://fonts.googleapis.com/css2?family=Caveat'), APP)).toBe(true)
  expect(isCacheFirst(new URL('https://fonts.gstatic.com/s/caveat/x.woff2'), APP)).toBe(true)
})

test('a cross-origin asset that is not a font is not cache-first', () => {
  expect(isCacheFirst(new URL('https://evil.example/assets/x.js'), APP)).toBe(false)
})

test('navigations are detected by mode or destination', () => {
  expect(isNavigation({ mode: 'navigate', destination: '' })).toBe(true)
  expect(isNavigation({ mode: 'cors', destination: 'document' })).toBe(true)
  expect(isNavigation({ mode: 'cors', destination: 'script' })).toBe(false)
})
