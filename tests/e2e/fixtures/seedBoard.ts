import type { SupabaseClient } from '@supabase/supabase-js'
import { testBoardId, testClient, testUserId } from './supabase'

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
 *
 * **This fixture must match PRODUCTION's schema, which is one release behind its own branch.** E2E
 * runs against the production database while migrations apply only on merge, so the payload here has
 * to satisfy the schema as it exists *before* this PR's migration -- and still work after it.
 *
 * Both mistakes have now been made once each, in opposite directions:
 *
 *   - Dropping `tasks_infer_board_id` made this fixture a pre-cutover client (it sent no
 *     `board_id`) and it began failing closed on the release *after* the migration.
 *   - Removing `user_id` here in the same PR that relaxed it to nullable failed *immediately*,
 *     because production still had `NOT NULL` when E2E ran: `null value in column "user_id" ...
 *     violates not-null constraint`.
 *
 * So a column being retired stays in this payload for the release that makes it optional, and comes
 * out in the release that drops it -- one step later than feels natural. `user_id` came out here,
 * with the drop; `category` needed no such care, having a default on both sides. Nothing else in the
 * suite writes tasks.
 */
export const SEEDED_TITLES = ['Draft the launch note', 'Book the venue', 'Unscheduled idea']

/**
 * Fixed task ids, one per seeded row, in SEEDED_TITLES order.
 *
 * Deliberately NOT left to the database's `gen_random_uuid()` default, because two things the board
 * renders are functions of a task's id, and both made the visual canaries (#280) nondeterministic:
 *
 *   - **Card tilt.** `rotOf(task.id)` (src/theme/cardStyles.ts) hashes the id into the rotation
 *     cork and brutal apply to every card. A fresh UUID per seed meant a fresh tilt per run.
 *   - **Tie order.** Two seeded rows share `order_index` and `korder` 0, and `loadBoardTasks` reads
 *     in id order, so random ids could swap the two To Do cards in the kanban view.
 *
 * Measured, not assumed: the kanban canary matched its baseline on one run and differed by 14,936
 * pixels on the next, with no app change between them. The other cork/brutal canaries drifted the
 * same way and passed only because their cards are small enough to stay under the old 1% tolerance.
 *
 * Reusing the same ids every run is safe: the delete below clears this Board first, the INSERT grant
 * includes `id` (it is part of the `taskToRow` payload for upserts), and a primary key here is
 * fixture data, not a secret, which is what the realtime DELETE fan-out rule asks of a published table.
 */
export const SEEDED_IDS = [
  '00000000-0000-4000-8000-00000000e2e1',
  '00000000-0000-4000-8000-00000000e2e2',
  '00000000-0000-4000-8000-00000000e2e3',
]

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
let cached: { client: SupabaseClient; userId: string; boardId: string } | null = null

async function seedSession(): Promise<{ client: SupabaseClient; userId: string; boardId: string }> {
  if (!cached) {
    const client = await testClient()
    const userId = await testUserId(client)
    cached = { client, userId, boardId: await testBoardId(client) }
  }
  return cached
}

export async function seedBoard(options: SeedOptions = {}): Promise<void> {
  const { theme = 'cork', view = 'calendar', anchor = utcToday() } = options
  const { client, userId, boardId } = await seedSession()

  const { error: deleteError } = await client.from('tasks').delete().eq('board_id', boardId)
  if (deleteError) throw new Error(`seed: clearing tasks failed: ${deleteError.message}`)

  const { error: insertError } = await client.from('tasks').insert([
    {
      id: SEEDED_IDS[0],
      board_id: boardId,
      title: SEEDED_TITLES[0],
      day: anchor,
      order_index: 0,
      status: 'todo',
      color: 'yellow',
    },
    {
      id: SEEDED_IDS[1],
      board_id: boardId,
      title: SEEDED_TITLES[1],
      // +2 days always stays inside the rendered grid: the 42 cells pad the anchor month to whole
      // weeks, which leaves at least five trailing days past month end in every calendar layout.
      day: plusDays(anchor, 2),
      order_index: 0,
      status: 'doing',
      color: 'blue',
    },
    {
      id: SEEDED_IDS[2],
      board_id: boardId,
      title: SEEDED_TITLES[2],
      day: null,
      order_index: 0,
      status: 'todo',
      color: 'mint',
    },
  ])
  if (insertError) throw new Error(`seed: inserting tasks failed: ${insertError.message}`)

  // The signup trigger already created this row, so update rather than insert.
  const { error: settingsError } = await client
    .from('user_settings')
    .update({ theme, week_start: 0, timezone: 'UTC' })
    .eq('user_id', userId)
  if (settingsError) throw new Error(`seed: writing settings failed: ${settingsError.message}`)

  // Default View is a Membership Preference, not an Account one. It used to be seeded onto
  // `user_settings.default_view`; the app stopped reading that copy when the compatibility layer
  // was retired, so seeding it there would silently stop steering which view the board opens in --
  // a fixture that still "worked" while testing the wrong thing.
  const { error: viewError } = await client
    .from('board_memberships')
    .update({ default_view: view })
    .eq('board_id', boardId)
  if (viewError) throw new Error(`seed: writing the default view failed: ${viewError.message}`)

  // NO signOut() here. supabase-js defaults to scope 'global', which revokes every refresh token
  // for the user -- including the one baked into the storageState that globalSetup saved for the
  // browser. Runs would survive only while jwt_expiry (3600s, supabase/config.toml) outlasts the
  // suite; the first refresh attempt would sign the browser out mid-test. There is also nothing to
  // clean up: testClient() sets persistSession: false, so the session is memory-only.
}
