export function OfflineBanner({ savedAt }: { savedAt: number | null }) {
  const when = savedAt
    ? new Date(savedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : null
  return (
    <div
      role="status"
      style={{
        margin: '0 12px 8px',
        padding: '8px 12px',
        borderRadius: 10,
        background: '#2a2414',
        color: '#ffe9b8',
        border: '1px solid #5a4a2a',
        fontFamily: 'system-ui, sans-serif',
        fontSize: 13.5,
        lineHeight: 1.4,
      }}
    >
      <strong style={{ fontWeight: 700 }}>Offline.</strong>{' '}
      {when ? `Showing your board as of ${when}.` : 'Showing your last synced board.'} Changes are
      disabled until you reconnect.
    </div>
  )
}
