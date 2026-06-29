export function ErrorScreen({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'grid',
        placeItems: 'center',
        background: '#0b0f1f',
        color: '#eaf0ff',
        fontFamily: 'system-ui, sans-serif',
        padding: 20,
      }}
    >
      <div style={{ textAlign: 'center', maxWidth: 380 }}>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>
          Couldn’t load your board
        </div>
        <div style={{ opacity: 0.6, fontSize: 14, marginBottom: 18, lineHeight: 1.5 }}>
          {message}
        </div>
        <button
          type="button"
          onClick={onRetry}
          style={{
            padding: '10px 18px',
            borderRadius: 9,
            border: 'none',
            background: '#7c5cff',
            color: '#fff',
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          Retry
        </button>
      </div>
    </div>
  )
}
