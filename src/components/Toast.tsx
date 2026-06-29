import { useEffect } from 'react'

/** A transient error toast that auto-dismisses. Used to surface failed saves/syncs. */
export function Toast({
  message,
  onDismiss,
  duration = 4500,
}: {
  message: string
  onDismiss: () => void
  duration?: number
}) {
  useEffect(() => {
    const id = window.setTimeout(onDismiss, duration)
    return () => window.clearTimeout(id)
  }, [message, onDismiss, duration])

  return (
    <div
      role="alert"
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
        background: '#2a1414',
        color: '#ffd9d9',
        border: '1px solid #5a2a2a',
        borderRadius: 10,
        boxShadow: '0 16px 44px rgba(0,0,0,.45)',
        fontFamily: 'system-ui, sans-serif',
        fontSize: 13.5,
        lineHeight: 1.4,
        animation: 'modalIn .2s ease',
      }}
    >
      <span style={{ flex: 1 }}>
        <strong style={{ fontWeight: 700 }}>Couldn’t sync.</strong> {message}
      </span>
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
