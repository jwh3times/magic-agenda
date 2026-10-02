import { afterAll, beforeAll, expect, test } from 'vitest'
import {
  anonClient,
  createTestUser,
  currentBoardId,
  deleteTestUser,
  serviceClient,
  withPg,
  type TestUser,
} from './helpers'

/**
 * Board member labels at the database boundary (#489, part of #477).
 *
 * The maintainer's decisions, each pinned below: only a current Owner sets a label, only current
 * Owners see one, the labelled person never sees their own (even as an Owner), and a label is
 * remembered across a member leaving and being re-invited, because it is keyed by (Board, Account)
 * rather than by Membership.
 */

interface MemberRow {
  membership_id: string
  account_id: string
  role: string
  nickname: string | null
}

let owner: TestUser
let coOwner: TestUser
let editor: TestUser
let viewer: TestUser
let outsider: TestUser
let boardId: string
const membershipOf = new Map<string, string>()

async function members(user: TestUser): Promise<MemberRow[]> {
  const { data, error } = await user.client.rpc('board_members', { p_board_id: boardId })
  if (error) throw new Error(`board_members failed: ${error.message}`)
  return data
}

function nicknameOf(rows: MemberRow[], user: TestUser): string | null | undefined {
  return rows.find((row) => row.account_id === user.id)?.nickname
}

async function label(caller: TestUser, target: TestUser, nickname: string | null) {
  return caller.client.rpc('set_member_label', {
    p_membership_id: membershipOf.get(target.id)!,
    p_nickname: nickname as string,
  })
}

async function storedLabels(): Promise<{ account_id: string; nickname: string }[]> {
  return withPg(
    async (pg) =>
      (
        await pg.query<{ account_id: string; nickname: string }>(
          'select account_id, nickname from public.board_member_labels where board_id = $1',
          [boardId],
        )
      ).rows,
  )
}

async function addMember(user: TestUser, role: string): Promise<string> {
  return withPg(
    async (pg) =>
      (
        await pg.query<{ id: string }>(
          `insert into public.board_memberships (board_id, account_id, role)
           values ($1, $2, $3) returning id`,
          [boardId, user.id, role],
        )
      ).rows[0].id,
  )
}

beforeAll(async () => {
  owner = await createTestUser()
  coOwner = await createTestUser()
  editor = await createTestUser()
  viewer = await createTestUser()
  outsider = await createTestUser()
  boardId = await currentBoardId(owner.id)
  membershipOf.set(
    owner.id,
    await withPg(
      async (pg) =>
        (
          await pg.query<{ id: string }>(
            'select id from public.board_memberships where board_id = $1 and account_id = $2',
            [boardId, owner.id],
          )
        ).rows[0].id,
    ),
  )
  membershipOf.set(coOwner.id, await addMember(coOwner, 'owner'))
  membershipOf.set(editor.id, await addMember(editor, 'editor'))
  membershipOf.set(viewer.id, await addMember(viewer, 'viewer'))
})

afterAll(async () => {
  for (const user of [editor, viewer, outsider, coOwner, owner]) {
    if (user) await deleteTestUser(user)
  }
})

test('an Owner labels a member, and only Owners other than the labelled person see it', async () => {
  expect((await label(owner, editor, '  Eddie (design)  ')).error).toBeNull()
  expect((await label(owner, coOwner, 'Co')).error).toBeNull()

  // Stored trimmed.
  expect(await storedLabels()).toEqual(
    expect.arrayContaining([{ account_id: editor.id, nickname: 'Eddie (design)' }]),
  )

  // Both Owners see the editor's label; it is shared among co-Owners.
  expect(nicknameOf(await members(owner), editor)).toBe('Eddie (design)')
  expect(nicknameOf(await members(coOwner), editor)).toBe('Eddie (design)')
  // The labelled co-Owner never sees their own label; the Owner who set it does.
  expect(nicknameOf(await members(coOwner), coOwner)).toBeNull()
  expect(nicknameOf(await members(owner), coOwner)).toBe('Co')

  // Editors and Viewers see no labels at all, including on their own row.
  for (const caller of [editor, viewer]) {
    const rows = await members(caller)
    expect(rows.every((row) => row.nickname === null)).toBe(true)
  }
})

test('only a current Owner may set a label, and never on their own Membership', async () => {
  for (const caller of [editor, viewer]) {
    const { error } = await label(caller, owner, 'nope')
    expect(error?.message).toBe('not-owner')
  }
  expect((await label(outsider, editor, 'nope')).error?.message).toBe('membership-ended')
  expect((await label(owner, owner, 'Me')).error?.message).toBe('invalid-label')

  // anon and service_role have no EXECUTE at all.
  for (const client of [anonClient(), serviceClient()]) {
    const { error } = await client.rpc('set_member_label', {
      p_membership_id: membershipOf.get(editor.id)!,
      p_nickname: 'nope',
    })
    expect(error?.code).toBe('42501')
  }
})

test('over 80 characters is refused, and a blank label clears it', async () => {
  expect((await label(owner, viewer, 'x'.repeat(81))).error?.message).toBe('invalid-label')
  // 80 code points of a two-unit emoji still fit, matching char_length.
  expect((await label(owner, viewer, '😀'.repeat(80))).error).toBeNull()
  expect((await label(owner, viewer, '   ')).error).toBeNull()
  expect(nicknameOf(await members(owner), viewer)).toBeNull()
  expect((await storedLabels()).map((row) => row.account_id)).not.toContain(viewer.id)
})

test('a label survives the member leaving and comes back when they are re-invited', async () => {
  expect((await label(owner, viewer, 'Vic')).error).toBeNull()
  const removed = await owner.client.rpc('remove_member', {
    p_membership_id: membershipOf.get(viewer.id)!,
  })
  expect(removed.error).toBeNull()

  // Ended: the label cannot be changed for someone no longer on the Board...
  expect((await label(owner, viewer, 'Gone')).error?.message).toBe('member-ended')
  // ...but it is still stored, keyed by Board and Account.
  expect(await storedLabels()).toEqual(
    expect.arrayContaining([{ account_id: viewer.id, nickname: 'Vic' }]),
  )

  // A re-invite is a NEW Membership row; the label is found again by (Board, Account).
  membershipOf.set(viewer.id, await addMember(viewer, 'viewer'))
  expect(nicknameOf(await members(owner), viewer)).toBe('Vic')
})

test('no Data API role can read another Owner-only label directly, or write the table at all', async () => {
  // Direct reads follow the same rule as board_members(): Owners only, never your own label.
  const asOwner = await owner.client.from('board_member_labels').select('account_id, nickname')
  expect(asOwner.error).toBeNull()
  expect(asOwner.data?.map((row) => row.account_id)).toEqual(
    expect.arrayContaining([editor.id, coOwner.id]),
  )
  const asCoOwner = await coOwner.client.from('board_member_labels').select('account_id')
  expect(asCoOwner.data?.map((row) => row.account_id)).not.toContain(coOwner.id)
  for (const caller of [editor, viewer, outsider]) {
    const { data, error } = await caller.client.from('board_member_labels').select('*')
    expect(error).toBeNull()
    expect(data).toEqual([])
  }
  const anon = await anonClient().from('board_member_labels').select('*')
  expect(anon.data).toEqual([])

  // No INSERT, UPDATE, or DELETE grant for anyone: commands only.
  const insert = await owner.client
    .from('board_member_labels')
    .insert({ board_id: boardId, account_id: viewer.id, nickname: 'direct' })
  expect(insert.error?.code).toBe('42501')
  const update = await owner.client
    .from('board_member_labels')
    .update({ nickname: 'direct' })
    .eq('account_id', editor.id)
  expect(update.error?.code).toBe('42501')
})

test('deleting the labelled Account or the Board removes its labels', async () => {
  const doomed = await createTestUser()
  membershipOf.set(doomed.id, await addMember(doomed, 'editor'))
  expect((await label(owner, doomed, 'Temp')).error).toBeNull()
  await deleteTestUser(doomed)
  expect((await storedLabels()).map((row) => row.account_id)).not.toContain(doomed.id)

  const otherBoard = await currentBoardId(outsider.id)
  await withPg(async (pg) => {
    await pg.query(
      `insert into public.board_memberships (board_id, account_id, role) values ($1, $2, 'editor')`,
      [otherBoard, editor.id],
    )
    await pg.query(
      `insert into public.board_member_labels (board_id, account_id, nickname) values ($1, $2, 'x')`,
      [otherBoard, editor.id],
    )
    await pg.query('delete from public.boards where id = $1', [otherBoard])
    const left = await pg.query('select 1 from public.board_member_labels where board_id = $1', [
      otherBoard,
    ])
    expect(left.rowCount).toBe(0)
  })
})
