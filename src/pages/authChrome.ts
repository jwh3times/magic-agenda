import type { CSSProperties } from 'react'

/** Shared styling for the auth pages (Login, ResetPassword) — the dark glass card. */
export const authPage: CSSProperties = {
  minHeight: '100%',
  display: 'grid',
  placeItems: 'center',
  padding: 20,
  background:
    'radial-gradient(1200px 600px at 70% -10%, rgba(124,92,255,.25), transparent 60%), #0b0f1f',
  fontFamily: 'system-ui, sans-serif',
  color: '#eaf0ff',
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
  background: '#7c5cff',
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
