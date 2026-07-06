import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'

/**
 * Irreversible account deletion. The typed confirmation is the friction that
 * guards it; the server function only ever deletes the verified caller.
 */
export function DangerZone() {
  const { signOut } = useAuth()
  const navigate = useNavigate()
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const armed = confirm.trim().toLowerCase() === 'delete'

  const deleteAccount = async () => {
    setBusy(true)
    setError(null)
    try {
      const { error: err } = await supabase.functions.invoke('delete-account', { method: 'POST' })
      if (err) throw new Error(err.message)
    } catch {
      // Same message for a resolved `{ error }` and a thrown/rejected invoke.
      setError('Could not delete your account. Please try again or contact support.')
      setBusy(false)
      return
    }
    try {
      await signOut()
    } catch {
      // The server already invalidated the session; local sign-out noise is fine to ignore.
    }
    navigate('/login', { replace: true, state: { accountDeleted: true } })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 420 }}>
      <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5 }}>
        Permanently delete your account and all of your tasks and settings. This cannot be undone.
        Type <strong>delete</strong> to confirm.
      </p>
      <input
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        placeholder="delete"
        aria-label="Type delete to confirm"
        // ≥16px so iOS Safari doesn't zoom on focus.
        style={{ fontSize: 16, padding: '8px 10px', maxWidth: 240 }}
      />
      {error && <div style={{ color: '#b42318', fontSize: 13 }}>{error}</div>}
      <button
        type="button"
        disabled={!armed || busy}
        onClick={deleteAccount}
        style={{
          alignSelf: 'flex-start',
          padding: '10px 14px',
          borderRadius: 8,
          border: '1px solid #b42318',
          background: armed && !busy ? '#b42318' : 'transparent',
          color: armed && !busy ? '#fff' : '#b42318',
          fontWeight: 700,
          fontSize: 14,
          cursor: armed && !busy ? 'pointer' : 'default',
          opacity: busy ? 0.6 : 1,
        }}
      >
        {busy ? 'Deleting…' : 'Delete my account'}
      </button>
    </div>
  )
}
