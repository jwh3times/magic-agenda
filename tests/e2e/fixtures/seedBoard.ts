import type { SupabaseClient } from '@supabase/supabase-js'
import { testClient, testUserId } from './supabase'

/**
 * Resets the E2E account to a known board.
 *
 * Dates are RELATIVE to an anchor day, not absolute. `Board` anchors on today
 * (src/components/Board.tsx:120) and `CalendarView` renders a fixed 42-cell grid around that
 * month (src/data/selectors.ts:35-58) -- so a row hard-coded to 2026-06-15 exists in the database
 * and renders on no screen. An assertion against it fails while the app is perfectly healthy.
 *
 * The anchor is computed in UTC to match the seeded `timezone: 'UTC'`, which is what the app reads
 * today through `todayYmd(tz)`. Computing it in the runner's local zone instead would disagree
 * with the board for a few hours either side of midnight.
 *
 * The date helpers are duplicated rather than imported from src/lib/dates.ts on purpose: `tests/**`
 * is a separate tsconfig project and imports nothing from `src/**` anywhere in this repo today.
 *
 * Column names are ROW shape, not app shape: `order_index` (not `order`, which is reserved SQL),
 * and `day` is a real NULL for the inbox rather than the app's `'inbox'` sentinel. That mapping
 * lives in src/data/mappers.ts and does not apply here -- see AGENTS.md.
 */
export const SEEDED_TITLES = ['Draft the launch note', 'Book the venue', 'Unscheduled idea']

export type Theme = 'cork' | 'brutal' | 'glass'
export type View = 'calendar' | 'week' | 'agenda' | 'kanban'

export interface SeedOptions {
  theme?: Theme
  /** Seeded `default_view`. Task 5 uses 'kanban' when the fixed clock turns out unusable. */
  view?: View
  /**
   * 'YYYY-MM-DD' anchor for the two dated rows; the second lands two days later. Defaults to today
   * in UTC. If a test pins `page.clock`, it MUST pass the matching anchor -- the clock moves the
   * board's month while this fixture still runs in real time.
   */
  anchor?: string
}

const utcToday = (): string => new Date().toISOString().slice(0, 10)

function plusDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/**
 * One sign-in per run, reused across every seedBoard() call.
 *
 * `supabase/config.toml` caps sign-ins at 30 per 5 minutes per IP and CI egress is shared, so a
 * fresh password grant per seed (~10 a run) spends that budget for nothing.
 */
let cached: { client: SupabaseClient; userId: string } | null = null

async function seedSession(): Promise<{ client: SupabaseClient; userId: string }> {
  if (!cached) {
    const client = await testClient()
    cached = { client, userId: await testUserId(client) }
  }
  return cached
}

export async function seedBoard(options: SeedOptions = {}): Promise<void> {
  const { theme = 'cork', view = 'calendar', anchor = utcToday() } = options
  const { client, userId } = await seedSession()

  const { error: deleteError } = await client.from('tasks').delete().eq('user_id', userId)
  if (deleteError) throw new Error(`seed: clearing tasks failed: ${deleteError.message}`)

  const { error: insertError } = await client.from('tasks').insert([
    {
      user_id: userId,
      title: SEEDED_TITLES[0],
      day: anchor,
      order_index: 0,
      status: 'todo',
      category: 'work',
      color: 'yellow',
    },
    {
      user_id: userId,
      title: SEEDED_TITLES[1],
      // +2 days always stays inside the rendered grid: the 42 cells pad the anchor month to whole
      // weeks, which leaves at least five trailing days past month end in every calendar layout.
      day: plusDays(anchor, 2),
      order_index: 0,
      status: 'doing',
      category: 'personal',
      color: 'blue',
    },
    {
      user_id: userId,
      title: SEEDED_TITLES[2],
      day: null,
      order_index: 0,
      status: 'todo',
      category: 'ideas',
      color: 'mint',
    },
  ])
  if (insertError) throw new Error(`seed: inserting tasks failed: ${insertError.message}`)

  // The signup trigger already created this row, so update rather than insert.
  const { error: settingsError } = await client
    .from('user_settings')
    .update({ theme, default_view: view, week_start: 0, timezone: 'UTC' })
    .eq('user_id', userId)
  if (settingsError) throw new Error(`seed: writing settings failed: ${settingsError.message}`)

  // NO signOut() here. supabase-js defaults to scope 'global', which revokes every refresh token
  // for the user -- including the one baked into the storageState that globalSetup saved for the
  // browser. Runs would survive only while jwt_expiry (3600s, supabase/config.toml) outlasts the
  // suite; the first refresh attempt would sign the browser out mid-test. There is also nothing to
  // clean up: testClient() sets persistSession: false, so the session is memory-only.
}
