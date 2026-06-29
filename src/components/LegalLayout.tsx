import type { CSSProperties, ReactNode } from 'react'

const link: CSSProperties = { color: '#a78bfa', textDecoration: 'none' }

/** Shared, theme-agnostic shell for the public legal pages (/privacy, /terms). */
export function LegalLayout({
  title,
  lastUpdated,
  children,
}: {
  title: string
  lastUpdated: string
  children: ReactNode
}) {
  return (
    <div
      style={{
        minHeight: '100%',
        background: '#0b0f1f',
        color: '#e7ecf6',
        fontFamily: 'system-ui, sans-serif',
        padding: '40px 20px 64px',
      }}
    >
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        <a href="/" style={{ ...link, fontSize: 14 }}>
          ← Magic Agenda
        </a>
        <h1 style={{ fontFamily: "'Caveat', cursive", fontSize: 44, margin: '18px 0 2px' }}>
          {title}
        </h1>
        <p style={{ opacity: 0.5, fontSize: 13, margin: '0 0 28px' }}>
          Last updated: {lastUpdated}
        </p>
        <div style={{ fontSize: 15, lineHeight: 1.65 }}>{children}</div>
        <div
          style={{
            marginTop: 40,
            paddingTop: 18,
            borderTop: '1px solid rgba(255,255,255,.1)',
            fontSize: 13,
            opacity: 0.6,
          }}
        >
          Questions about this policy? Contact{' '}
          <a href="mailto:jerryholland00@gmail.com" style={link}>
            jerryholland00@gmail.com
          </a>
          .
        </div>
      </div>
    </div>
  )
}
