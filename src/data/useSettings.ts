import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
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

/** Loads + persists the user's theme and default view. A signup trigger seeds the row. */
export function useSettings(userId: string): UseSettings {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [loading, setLoading] = useState(true)
  const ref = useRef<Settings>(DEFAULTS)
  const lastLocalWrite = useRef(0)

  useEffect(() => {
    let active = true
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    supabase
      .from('user_settings')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle()
      .then(({ data }) => {
        if (!active) return
        const next: Settings = data
          ? { theme: data.theme as ThemeName, defaultView: data.default_view as ViewName }
          : DEFAULTS
        ref.current = next
        setSettings(next)
        setLoading(false)
      })
    return () => {
      active = false
    }
  }, [userId])

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
          ref.current = next
          setSettings(next)
        },
      )
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [userId])

  const persist = useCallback(
    (next: Settings) => {
      lastLocalWrite.current = Date.now()
      ref.current = next
      setSettings(next)
      // Must call `.then()` — a Supabase builder is a lazy thenable that only sends
      // its request when awaited/then'd. `void <builder>` would never fire it.
      void supabase
        .from('user_settings')
        .upsert(
          { user_id: userId, theme: next.theme, default_view: next.defaultView },
          { onConflict: 'user_id' },
        )
        .then(({ error }) => {
          if (error) console.error('Failed to save settings', error)
        })
    },
    [userId],
  )

  const saveTheme = useCallback((theme: ThemeName) => persist({ ...ref.current, theme }), [persist])
  const saveView = useCallback(
    (view: ViewName) => persist({ ...ref.current, defaultView: view }),
    [persist],
  )

  return { settings, loading, saveTheme, saveView }
}
