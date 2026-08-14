import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { canPersistSnapshot, readSettingsSnapshot, writeSettingsSnapshot } from './snapshot'
import { useOwnWrites, useSyncedTable, type ChangePayload } from './useSyncedTable'
import type { ThemeName, ViewName } from '../types/task'

export interface Settings {
  theme: ThemeName
  defaultView: ViewName
  /** 0=Sunday … 6=Saturday. */
  weekStart: number
  /** IANA id; null means "follow the browser". */
  timezone: string | null
}

const DEFAULTS: Settings = {
  theme: 'cork',
  defaultView: 'calendar',
  weekStart: 0,
  timezone: null,
}

export interface UseSettings {
  settings: Settings | null
  loading: boolean
  saveTheme: (theme: ThemeName) => void
  saveView: (view: ViewName) => void
  saveWeekStart: (weekStart: number) => void
  saveTimezone: (timezone: string | null) => void
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
  const { markWrites, isOwnWrite } = useOwnWrites()

  // The one place settings become current: keeps the ref, React state, and the offline
  // snapshot in step, so no caller can update two of the three and forget the last.
  //
  // `persistSnapshot` is decided per call site, because the two kinds of caller answer different
  // questions. A **load** must consult `canPersistSnapshot` — what came back may be RLS answering
  // "nothing" rather than the server confirming anything. A **user's own save** always persists:
  // it is a deliberate choice, and it must survive a reload even when the upsert behind it failed
  // because the device is offline.
  const apply = useCallback(
    (next: Settings, persistSnapshot = true) => {
      ref.current = next
      setSettings(next)
      if (persistSnapshot) writeSettingsSnapshot(userId, next)
    },
    [userId],
  )

  const load = useCallback(() => {
    // Signed out. This hook runs from a provider mounted above <Routes>, so it also mounts on
    // the public landing page — without this guard every signed-out visitor would fire a
    // user_settings query for `user_id = ''`.
    if (!userId) {
      setSettings(null)
      setLoading(false)
      return
    }
    setLoading(true)
    void supabase
      .from('user_settings')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle()
      .then(({ data, error }) => {
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
        // something. That is `canPersistSnapshot`'s `hasSession` clause, inside `apply`.
        //
        // The row-present branch can legitimately see `hasSession === false` too: supabase-js
        // attaches the persisted access token independently of `AuthProvider`'s React state, and
        // `SettingsProvider` mounts above the auth-loading gate, so the first query here can fire
        // with `hasSession === false` and still come back with the user's real row — which this
        // then declines to persist. That's fine only because `hasSession` is in this effect's
        // dependency array below: when it flips to true the effect reruns and the second query
        // persists the snapshot. Do not drop it from the deps as a "redundant re-fetch".
        apply(
          data
            ? {
                theme: data.theme as ThemeName,
                defaultView: data.default_view as ViewName,
                // `??` rather than a plain read: during the deploy window between the migration
                // and the Pages build, a row can come back without these columns at all.
                weekStart: data.week_start ?? 0,
                timezone: data.timezone ?? null,
              }
            : DEFAULTS,
          // `loadedFromServer: true` because reaching this branch *is* the server having answered
          // without error — unlike useTasks, there is no separate "loaded a real board" signal to
          // track. The ambiguity that matters here (a row-less answer from an unauthenticated
          // select looks identical to a genuinely empty row) is what `hasSession` disambiguates.
          canPersistSnapshot({
            userId,
            hasSession,
            offline: false,
            loading: false,
            loadedFromServer: true,
          }),
        )
        setLoading(false)
      })
  }, [userId, hasSession, apply])

  useEffect(() => {
    // `load()`'s synchronous prefix calls setLoading/setSettings. Safe for the same reason as the
    // equivalent disable in useTasks.ts: it fires once rather than in a loop, the initial values
    // are Object.is-identical to the useState defaults so React bails out of the re-render, and
    // `load` is stable across renders that don't change `userId`/`hasSession`, so calling it
    // cannot re-trigger this effect.
    // oxlint-disable-next-line react/react-compiler
    load()
  }, [load])

  // Live settings changes from other devices. Echoes of our own upsert are filtered by
  // useSyncedTable (keyed on user_id, this table's primary key) before reaching this.
  const onRemoteChange = useCallback(
    (payload: ChangePayload) => {
      const row = payload.new as {
        theme?: string
        default_view?: string
        week_start?: number
        timezone?: string | null
      } | null
      if (!row?.theme || !row.default_view) return
      const next: Settings = {
        theme: row.theme as ThemeName,
        defaultView: row.default_view as ViewName,
        weekStart: row.week_start ?? 0,
        timezone: row.timezone ?? null,
      }
      // Second line of defence behind the echo filter: an identical payload must not re-render
      // or re-snapshot. (useTasks' equivalent is `sameTask` inside the realtime reducer.)
      if (
        next.theme === ref.current.theme &&
        next.defaultView === ref.current.defaultView &&
        next.weekStart === ref.current.weekStart &&
        next.timezone === ref.current.timezone
      )
        return
      apply(next)
    },
    [apply],
  )

  useSyncedTable({
    userId,
    table: 'user_settings',
    // The settings row is keyed by the user, not by a synthetic id.
    primaryKey: 'user_id',
    // Account Preferences genuinely are account-scoped, so this one stays on `user_id`.
    filterColumn: 'user_id',
    filterValue: userId,
    reload: load,
    onChange: onRemoteChange,
    isOwnWrite,
  })

  const persist = useCallback(
    (next: Settings) => {
      markWrites([userId])
      apply(next)
      // Must call `.then()` — a Supabase builder is a lazy thenable that only sends
      // its request when awaited/then'd. `void <builder>` would never fire it.
      void supabase
        .from('user_settings')
        .upsert(
          {
            user_id: userId,
            theme: next.theme,
            default_view: next.defaultView,
            week_start: next.weekStart,
            timezone: next.timezone,
          },
          { onConflict: 'user_id' },
        )
        .then(
          ({ error }) => {
            if (error) console.error('Failed to save settings', error)
          },
          (e: unknown) => console.error('Failed to save settings', e),
        )
    },
    [userId, apply, markWrites],
  )

  const saveTheme = useCallback((theme: ThemeName) => persist({ ...ref.current, theme }), [persist])
  const saveView = useCallback(
    (view: ViewName) => persist({ ...ref.current, defaultView: view }),
    [persist],
  )
  const saveWeekStart = useCallback(
    (weekStart: number) => persist({ ...ref.current, weekStart }),
    [persist],
  )
  const saveTimezone = useCallback(
    (timezone: string | null) => persist({ ...ref.current, timezone }),
    [persist],
  )

  return { settings, loading, saveTheme, saveView, saveWeekStart, saveTimezone }
}
