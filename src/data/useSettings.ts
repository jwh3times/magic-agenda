import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { readSettingsSnapshot, writeSettingsSnapshot } from './snapshot'
import type { ThemeName, ViewName } from '../types/task'

export interface Settings {
  theme: ThemeName
  defaultView: ViewName
}

const DEFAULTS: Settings = { theme: 'cork', defaultView: 'calendar' }

export interface UseSettings {
  settings: Settings | null
  loading: boolean
  saveTheme: (theme: ThemeName) => void
  saveView: (view: ViewName) => void
}

/**
 * Loads + persists the user's theme and default view. A signup trigger seeds the row.
 *
 * `userId` is only a resolved id for *reading* — it is fine to be the last-known id from
 * `readLastUserId()` with no live session behind it (that's what lets an offline boot look up
 * its snapshot). `hasSession` is the separate, stricter signal for *writing*: true only when
 * there is an actual authenticated session. The two diverge for a signed-out visitor whose
 * session vanished without a `SIGNED_OUT` event — `userId` stays non-empty (from the stale
 * `ma-last-user`) while `hasSession` is false. See the `data === null` branch below.
 */
export function useSettings(userId: string, hasSession: boolean): UseSettings {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [loading, setLoading] = useState(true)
  const ref = useRef<Settings>(DEFAULTS)
  const lastLocalWrite = useRef(0)

  // The one place settings become current: keeps the ref, React state, and the offline
  // snapshot in step, so no caller can update two of the three and forget the last.
  const apply = useCallback(
    (next: Settings, persistSnapshot = true) => {
      ref.current = next
      setSettings(next)
      if (persistSnapshot) writeSettingsSnapshot(userId, next)
    },
    [userId],
  )

  useEffect(() => {
    let active = true
    // Signed out. This hook now runs from a provider mounted above <Routes>, so it also mounts on
    // the public landing page — without this guard every signed-out visitor would fire a
    // user_settings query for `user_id = ''`.
    if (!userId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSettings(null)
      setLoading(false)
      return
    }
    setLoading(true)
    supabase
      .from('user_settings')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!active) return
        if (error) {
          // A failed request is NOT "no row yet" — postgrest resolves with { data: null, error }
          // rather than rejecting, so treating them alike would silently reset the user's theme
          // to DEFAULTS on every offline boot. Fall back to the last known settings instead, and
          // do not re-snapshot: nothing new was learned.
          apply(readSettingsSnapshot(userId)?.settings ?? DEFAULTS, false)
          setLoading(false)
          return
        }
        // No error and no row: under RLS this is indistinguishable between "authenticated user
        // who genuinely has no settings row yet" and "no session at all" (an unauthenticated
        // select resolves `{ data: null, error: null }`, not an error). Only the former should
        // overwrite the settings snapshot with DEFAULTS — a signed-out visitor with a stale
        // `ma-last-user` must not clobber the real snapshot just because `userId` resolved to
        // something. `apply`'s persist is therefore gated on `hasSession`, not on `userId`.
        apply(
          data
            ? { theme: data.theme as ThemeName, defaultView: data.default_view as ViewName }
            : DEFAULTS,
          hasSession,
        )
        setLoading(false)
      })
    return () => {
      active = false
    }
  }, [userId, hasSession, apply])

  // Live settings changes from other devices. Skip events shortly after a local
  // persist — the echo of our own upsert could otherwise transiently revert a
  // rapid second change.
  useEffect(() => {
    if (!userId) return
    const channel = supabase
      .channel(`settings-${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'user_settings', filter: `user_id=eq.${userId}` },
        (payload) => {
          if (Date.now() - lastLocalWrite.current < 3000) return
          const row = payload.new as { theme?: string; default_view?: string } | null
          if (!row?.theme || !row.default_view) return
          const next: Settings = {
            theme: row.theme as ThemeName,
            defaultView: row.default_view as ViewName,
          }
          if (next.theme === ref.current.theme && next.defaultView === ref.current.defaultView)
            return
          apply(next)
        },
      )
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [userId, apply])

  const persist = useCallback(
    (next: Settings) => {
      lastLocalWrite.current = Date.now()
      apply(next)
      // Must call `.then()` — a Supabase builder is a lazy thenable that only sends
      // its request when awaited/then'd. `void <builder>` would never fire it.
      void supabase
        .from('user_settings')
        .upsert(
          { user_id: userId, theme: next.theme, default_view: next.defaultView },
          { onConflict: 'user_id' },
        )
        .then(
          ({ error }) => {
            if (error) console.error('Failed to save settings', error)
          },
          (e: unknown) => console.error('Failed to save settings', e),
        )
    },
    [userId, apply],
  )

  const saveTheme = useCallback((theme: ThemeName) => persist({ ...ref.current, theme }), [persist])
  const saveView = useCallback(
    (view: ViewName) => persist({ ...ref.current, defaultView: view }),
    [persist],
  )

  return { settings, loading, saveTheme, saveView }
}
