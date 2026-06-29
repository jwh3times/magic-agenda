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

  useEffect(() => {
    let active = true
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

  const persist = useCallback(
    (next: Settings) => {
      ref.current = next
      setSettings(next)
      void supabase
        .from('user_settings')
        .upsert(
          { user_id: userId, theme: next.theme, default_view: next.defaultView },
          { onConflict: 'user_id' },
        )
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
