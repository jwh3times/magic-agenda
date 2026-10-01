import { useEffect, useState, type CSSProperties } from 'react'
import { useAuth } from '../auth/AuthProvider'
import {
  DISPLAY_NAME_MAX,
  displayNameError,
  loadDisplayName,
  normalizeDisplayName,
  saveDisplayName,
} from '../data/accountProfile'
import { useThemeOrDefault } from '../theme/ThemeProvider'
import { Button, TextInput } from './controls'

const hint: CSSProperties = { fontSize: 12.5, opacity: 0.75, margin: 0 }
const label: CSSProperties = { fontSize: 13, opacity: 0.7 }

/**
 * The Account's Display Name (#475). Until this existed nothing in the app could set one, so every
 * member of a shared Board, the Owner included, read as "Unnamed member".
 *
 * Needs a live session: on the offline-boot fallback there is no `user`, and the write would be
 * refused anyway, so the section says so instead of offering a Save that cannot work.
 */
export function ProfileSection() {
  const { conf } = useThemeOrDefault()
  const { user } = useAuth()
  const accountId = user?.id ?? null
  // `saved` is null until the stored name has loaded; the field stays disabled until then so a
  // fast typist cannot be overwritten by the load landing.
  const [saved, setSaved] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  useEffect(() => {
    if (!accountId) return
    let cancelled = false
    void loadDisplayName(accountId).then((result) => {
      if (cancelled) return
      if (result.ok) {
        setSaved(result.data)
        setDraft(result.data)
      } else {
        setError(`Could not load your name: ${result.message}`)
      }
    })
    return () => {
      cancelled = true
    }
  }, [accountId])

  if (!accountId) {
    return <p style={hint}>Your name can be changed when you are back online.</p>
  }

  const next = normalizeDisplayName(draft)
  const invalid = displayNameError(next)
  const unchanged = saved !== null && next === saved

  const save = async () => {
    setBusy(true)
    setError(null)
    setStatus(null)
    const result = await saveDisplayName(accountId, draft)
    setBusy(false)
    if (!result.ok) {
      setError(result.message)
      return
    }
    setSaved(result.data)
    setDraft(result.data)
    setStatus(result.data ? 'Saved.' : 'Saved. You will show as "Unnamed member".')
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (!busy && !invalid && !unchanged) void save()
      }}
      style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
    >
      <label htmlFor="settings-display-name" style={label}>
        Display name
      </label>
      <div style={{ display: 'flex', gap: 8, minWidth: 0 }}>
        <TextInput
          id="settings-display-name"
          value={draft}
          autoComplete="name"
          placeholder="Unnamed member"
          disabled={saved === null || busy}
          aria-invalid={invalid ? true : undefined}
          aria-describedby="settings-display-name-hint"
          onChange={(e) => {
            setDraft(e.target.value)
            setStatus(null)
          }}
          style={{ flex: '1 1 auto', minWidth: 0, maxWidth: 360 }}
        />
        <Button
          type="submit"
          variant="primary"
          disabled={saved === null || busy || !!invalid || unchanged}
          style={{ flexShrink: 0 }}
        >
          Save
        </Button>
      </div>
      <p id="settings-display-name-hint" style={hint}>
        Members of boards shared with you see this name in the Members list and on Tasks assigned to
        you, and board owners see it in board activity. Up to {DISPLAY_NAME_MAX} characters; leave
        it empty to show as &ldquo;Unnamed member&rdquo;.
      </p>
      {invalid && (
        <div role="alert" style={{ color: conf.dangerFg, fontSize: 13 }}>
          {invalid}
        </div>
      )}
      {error && (
        <div role="alert" style={{ color: conf.dangerFg, fontSize: 13 }}>
          {error}
        </div>
      )}
      <div role="status" style={{ fontSize: 13 }}>
        {status}
      </div>
    </form>
  )
}
