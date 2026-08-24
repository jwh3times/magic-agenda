import { useEffect } from 'react'

const PALETTE = {
  error: { background: '#2a1414', color: '#ffd9d9', border: '1px solid #5a2a2a' },
  info: { background: '#14202a', color: '#d9ecff', border: '1px solid #2a4a5a' },
}

/**
 * A transient toast that auto-dismisses. `tone` selects styling and accessibility role:
 * 'error' (default) surfaces failed saves/syncs with the "Couldn't sync." prefix and
 * `role="alert"`; 'info' drops the prefix, uses `role="status"`, and can carry an
 * optional action button (e.g. "Refresh" for an available update).
 */
export function Toast({
  message,
  onDismiss,
  duration = 4500,
  tone = 'error',
  action,
}: {
  message: string
  onDismiss: () => void
  duration?: number
  tone?: 'error' | 'info'
  action?: { label: string; onClick: () => void }
}) {
  useEffect(() => {
    const id = window.setTimeout(onDismiss, duration)
    return () => window.clearTimeout(id)
    // A replacement message restarts the dismissal window even though the callback does not read it.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [message, onDismiss, duration])

  const palette = PALETTE[tone]

  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      style={{
        position: 'fixed',
        bottom: 20,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 9500,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        maxWidth: 'min(440px, 92vw)',
        padding: '12px 14px 12px 16px',
        background: palette.background,
        color: palette.color,
        border: palette.border,
        borderRadius: 10,
        boxShadow: '0 16px 44px rgba(0,0,0,.45)',
        fontFamily: 'system-ui, sans-serif',
        fontSize: 13.5,
        lineHeight: 1.4,
        animation: 'modalIn .2s ease',
      }}
    >
      <span style={{ flex: 1 }}>
        {tone === 'error' && <strong style={{ fontWeight: 700 }}>Couldn’t sync. </strong>}
        {message}
      </span>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          style={{
            background: 'transparent',
            border: '1px solid currentColor',
            borderRadius: 6,
            color: 'inherit',
            cursor: 'pointer',
            fontSize: 12.5,
            fontWeight: 600,
            padding: '4px 10px',
          }}
        >
          {action.label}
        </button>
      )}
      <button
        type="button"
        aria-label="Dismiss"
        onClick={onDismiss}
        style={{
          background: 'transparent',
          border: 'none',
          color: 'inherit',
          cursor: 'pointer',
          fontSize: 15,
          opacity: 0.7,
          padding: 0,
        }}
      >
        ✕
      </button>
    </div>
  )
}
