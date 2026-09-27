import { REALTIME_SUBSCRIBE_STATES, type RealtimeChannel } from '@supabase/supabase-js'
import { afterAll, expect, test } from 'vitest'
import { createTestUser, currentBoardId, deleteTestUser, withPg, type TestUser } from './helpers'

/**
 * Live revocation over Realtime, against the local stack's real Realtime service (#439).
 *
 * `board_memberships` is published so a removed member's open tab hears the UPDATE that ends its
 * Membership. The property that makes that safe is that Realtime applies the table's SELECT policy
 * to every INSERT/UPDATE it delivers: each member hears **only their own row**, because a row
 * carries its member's calendar-feed token. Both halves are asserted — the removed member hears
 * its revocation, and a co-member subscribed to the same table hears nothing — and the silent half
 * has a positive control, since a subscription that never connected would also hear nothing.
 */

type Change = { eventType: string; new: Record<string, unknown> }

const everyone: TestUser[] = []
const channels: RealtimeChannel[] = []

async function user(): Promise<TestUser> {
  const created = await createTestUser()
  everyone.push(created)
  return created
}

/** Subscribes to every change on `board_memberships` as `member`, resolving once subscribed. */
async function listen(member: TestUser): Promise<Change[]> {
  const heard: Change[] = []
  const {
    data: { session },
  } = await member.client.auth.getSession()
  await member.client.realtime.setAuth(session!.access_token)
  const channel = member.client
    .channel(`memberships-${member.id}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'board_memberships' }, (p) =>
      heard.push(p as unknown as Change),
    )
  channels.push(channel)
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('realtime subscribe timed out')), 15_000)
    channel.subscribe((status) => {
      if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) {
        clearTimeout(timer)
        resolve()
      }
    })
  })
  return heard
}

async function until(predicate: () => boolean, ms = 10_000): Promise<boolean> {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (predicate()) return true
    await new Promise((r) => setTimeout(r, 100))
  }
  return predicate()
}

afterAll(async () => {
  for (const channel of channels) await channel.unsubscribe()
  await withPg((pg) =>
    pg.query(
      `update public.board_memberships set ended_at = now(), end_reason = 'removed'
        where account_id = any($1) and ended_at is null and role <> 'owner'`,
      [everyone.map((u) => u.id)],
    ),
  )
  for (const created of everyone) await deleteTestUser(created)
})

test('a removed member hears their own revocation; a co-member hears nothing', async () => {
  const owner = await user()
  const removed = await user()
  const staying = await user()
  const boardId = await currentBoardId(owner.id)
  const ids: Record<string, string> = {}
  await withPg(async (pg) => {
    for (const [member, role] of [
      [removed, 'editor'],
      [staying, 'viewer'],
    ] as const) {
      const { rows } = await pg.query<{ id: string }>(
        `insert into public.board_memberships (board_id, account_id, role)
         values ($1, $2, $3) returning id`,
        [boardId, member.id, role],
      )
      ids[member.id] = rows[0].id
    }
  })

  const removedHeard = await listen(removed)
  const stayingHeard = await listen(staying)

  // Positive control: the co-member's subscription is live, proven by an update to their own row.
  // Repeated until heard, because a freshly started stack's Realtime can report SUBSCRIBED before
  // its replication stream delivers anything — measured: the first run after `db reset` missed a
  // single update. This doubles as the warm-up for the removal below.
  const views = ['agenda', 'week'] as const
  let heardOwn = false
  for (let attempt = 0; attempt < 30 && !heardOwn; attempt++) {
    const own = await staying.client
      .from('board_memberships')
      .update({ default_view: views[attempt % 2] })
      .eq('id', ids[staying.id])
    expect(own.error).toBeNull()
    heardOwn = await until(() => stayingHeard.some((c) => c.new.id === ids[staying.id]), 1_000)
  }
  expect(heardOwn).toBe(true)

  const { error } = await owner.client.rpc('remove_member', { p_membership_id: ids[removed.id] })
  expect(error).toBeNull()

  expect(
    await until(() =>
      removedHeard.some(
        (c) => c.eventType === 'UPDATE' && c.new.id === ids[removed.id] && c.new.ended_at !== null,
      ),
    ),
  ).toBe(true)

  // Give the co-member's channel the same window to (wrongly) hear the removal.
  await new Promise((r) => setTimeout(r, 2_000))
  const leaked = stayingHeard.filter((c) => c.new.id !== ids[staying.id])
  expect(leaked).toEqual([])
  // And the removed member heard nothing but their own row — never a co-member's feed token.
  expect(removedHeard.every((c) => c.new.account_id === removed.id)).toBe(true)
}, 60_000)
