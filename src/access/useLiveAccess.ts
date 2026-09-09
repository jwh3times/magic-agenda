import { useCallback, useEffect, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { useAuth } from '../auth/AuthProvider'
import { useOnline } from '../lib/useOnline'

/** Session-scoped, memory-only hints. RLS remains authoritative for every write. */
export function useLiveAccess<T>(read: (userId: string) => Promise<T>, fallback: T) {
  const { session } = useAuth()
  const online = useOnline()
  const sequence = useRef(0)
  const invalidate = useCallback(() => {
    sequence.current++
  }, [])
  const [state, setState] = useState<{
    session: Session | null
    online: boolean
    value: T
    loading: boolean
    error: string | null
  }>({ session, online, value: fallback, loading: !!session && online, error: null })

  // Reset during the source transition, before children can observe another
  // session's hints or a pre-offline value on reconnect.
  if (state.session !== session || state.online !== online) {
    setState({ session, online, value: fallback, loading: !!session && online, error: null })
  }

  const reload = useCallback((): Promise<void> => {
    const request = ++sequence.current
    if (!session || !online) return Promise.resolve()
    return Promise.resolve()
      .then(() => read(session.user.id))
      .then(
        (value) => {
          if (request === sequence.current) {
            setState({ session, online, value, loading: false, error: null })
          }
        },
        () => {
          if (request === sequence.current) {
            setState({
              session,
              online,
              value: fallback,
              loading: false,
              error: 'Unable to load access settings.',
            })
          }
        },
      )
  }, [session, online, read, fallback])

  useEffect(() => {
    void reload()
    const refresh = () => {
      void reload()
    }
    window.addEventListener('focus', refresh)
    const timer = window.setInterval(refresh, 60_000)
    return () => {
      invalidate()
      window.removeEventListener('focus', refresh)
      window.clearInterval(timer)
    }
  }, [reload, invalidate])

  const current = online && session !== null && state.session === session && state.online === online
  return {
    value: current ? state.value : fallback,
    loading: !!session && online && (!current || state.loading),
    error: current ? state.error : null,
    reload,
  }
}
