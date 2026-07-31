import type { CSSProperties } from 'react'

/** Shared styling for the auth pages (Login, ResetPassword) — the dark glass card. */
export const authPage: CSSProperties = {
  minHeight: '100%',
  display: 'grid',
  // Without an explicit column the implicit one is `auto`, which sizes to the item's max-content —
  // and that is driven by the logo. authCard's `width: min(400px, 100%)` then resolves its 100%
  // against that inflated column instead of the viewport, which is how a 390px phone ended up with
  // a 400px card and 59px of horizontal page overflow. minmax(0, 1fr) caps the column at the
  // container, so the percentage means what it looks like it means.
  gridTemplateColumns: 'minmax(0, 1fr)',
  placeItems: 'center',
  padding: 20,
  background:
    'radial-gradient(1200px 600px at 70% -10%, rgba(124,92,255,.25), transparent 60%), #0b0f1f',
  fontFamily: 'system-ui, sans-serif',
  color: '#eaf0ff',
}

/**
 * The wordmark on every auth card.
 *
 * `height: auto` is load-bearing, not a default. The source is 900×260, so a fixed `height: 110`
 * gives a used width of 381px with no way to shrink — 37px past the card's 344px content box at
 * every viewport width, and 59px past the viewport itself below ~450px. Clamping the width while
 * keeping the fixed height would squash the image instead, because `object-fit` defaults to `fill`.
 */
export const authLogo: CSSProperties = {
  maxWidth: '100%',
  height: 'auto',
  display: 'block',
}

export const authCard: CSSProperties = {
  width: 'min(400px, 100%)',
  background: 'rgba(255,255,255,.04)',
  border: '1px solid rgba(255,255,255,.1)',
  borderRadius: 18,
  padding: 28,
  boxShadow: '0 30px 80px rgba(0,0,0,.45)',
  backdropFilter: 'blur(12px)',
  WebkitBackdropFilter: 'blur(12px)',
}

export const authField: CSSProperties = {
  width: '100%',
  padding: '12px 14px',
  borderRadius: 10,
  border: '1px solid rgba(255,255,255,.12)',
  background: 'rgba(255,255,255,.05)',
  color: '#eaf0ff',
  fontSize: 16, // ≥16px so iOS Safari doesn't zoom on focus
  fontFamily: 'system-ui, sans-serif',
}

export const authSubmit: CSSProperties = {
  marginTop: 4,
  padding: '12px 14px',
  borderRadius: 10,
  border: 'none',
  background: '#7452ff',
  color: '#fff',
  fontSize: 14,
  fontWeight: 800,
}

export const authLinkBtn: CSSProperties = {
  background: 'none',
  border: 'none',
  color: '#a78bfa',
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 700,
  padding: 0,
}
