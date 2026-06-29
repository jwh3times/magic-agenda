export function Spinner({ label = 'Loading…' }: { label?: string }) {
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
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
        <div
          style={{
            width: 34,
            height: 34,
            borderRadius: '50%',
            border: '3px solid rgba(255,255,255,.15)',
            borderTopColor: '#7c5cff',
            animation: 'spin .8s linear infinite',
          }}
        />
        <div style={{ opacity: 0.6, fontSize: 14 }}>{label}</div>
      </div>
    </div>
  )
}
