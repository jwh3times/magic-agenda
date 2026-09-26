import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, expect, test } from 'vitest'
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
 * The deletion Edge Functions' database commands (#447), called the way the functions call them:
 * as `service_role`.
 *
 * #447 existed because nothing ever did that. `delete-board` and `delete-account` read and deleted
 * Board rows through a service-role client that holds no privilege on those tables, and no test
 * called the tables as `service_role` — so the failure could only show up in production. Every
 * assertion here goes through `serviceClient()` for that reason.
 */

const everyone: TestUser[] = []

async function user(): Promise<TestUser> {
  const created = await createTestUser()
  everyone.push(created)
  return created
}

async function addMember(boardId: string, member: TestUser, role: string) {
  await withPg((pg) =>
    pg.query(
      `insert into public.board_memberships (board_id, account_id, role) values ($1, $2, $3)`,
      [boardId, member.id, role],
    ),
  )
}

async function boardExists(boardId: string): Promise<boolean> {
  return withPg(async (pg) => {
    const { rows } = await pg.query('select 1 from public.boards where id = $1', [boardId])
    return rows.length === 1
  })
}

async function plan(accountId: string) {
  const { data, error } = await serviceClient().rpc('account_deletion_plan', {
    p_account_id: accountId,
  })
  if (error) throw new Error(`account_deletion_plan failed: ${error.message}`)
  return data as { board_id: string; disposition: string }[]
}

afterAll(async () => {
  await withPg((pg) =>
    pg.query(
      `update public.board_memberships set ended_at = now(), end_reason = 'removed'
        where account_id = any($1) and ended_at is null and role <> 'owner'`,
      [everyone.map((u) => u.id)],
    ),
  )
  for (const created of everyone) {
    // Some tests delete their own users; a missing one is not a teardown failure.
    await deleteTestUser(created).catch(() => {})
  }
})

test('the Board tables still grant service_role no data privilege', async () => {
  // The posture #447 keeps: the functions reach these tables only through the commands below.
  // Only the four data privileges are asserted. Default privileges also leave service_role
  // TRUNCATE, REFERENCES, and TRIGGER on both tables, which is #283's residue, not this one's.
  const privileges = await withPg(async (pg) => {
    const { rows } = await pg.query<{ table_name: string; privilege_type: string }>(
      `select table_name, privilege_type from information_schema.role_table_grants
        where grantee = 'service_role' and table_schema = 'public'
          and table_name in ('boards', 'board_memberships')
          and privilege_type in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')`,
    )
    return rows
  })
  expect(privileges).toEqual([])
})

test('no Edge Function reads the Board tables directly', () => {
  // The regression guard: a direct `.from("boards")` through the service-role client is exactly
  // the call that has no privilege, and no local test can execute an Edge Function end to end.
  const root = join(process.cwd(), 'supabase', 'functions')
  const offenders: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) walk(path)
      else if (
        path.endsWith('.ts') &&
        /\.from\(\s*["'](boards|board_memberships)["']/.test(readFileSync(path, 'utf8'))
      )
        offenders.push(path)
    }
  }
  walk(root)
  expect(offenders).toEqual([])
})

test('is_current_board_owner answers for current Owners only', async () => {
  const owner = await user()
  const editor = await user()
  const stranger = await user()
  const boardId = await currentBoardId(owner.id)
  await addMember(boardId, editor, 'editor')

  const ask = async (accountId: string) =>
    (
      await serviceClient().rpc('is_current_board_owner', {
        p_board_id: boardId,
        p_account_id: accountId,
      })
    ).data
  expect(await ask(owner.id)).toBe(true)
  expect(await ask(editor.id)).toBe(false)
  expect(await ask(stranger.id)).toBe(false)
})

test('delete_board_as_owner deletes for the Owner and leaves the Board for anyone else', async () => {
  const owner = await user()
  const editor = await user()
  const { data: boardId } = await owner.client.rpc('create_board', { board_name: 'Doomed' })
  await addMember(boardId as string, editor, 'editor')

  const as = (accountId: string) =>
    serviceClient().rpc('delete_board_as_owner', {
      p_board_id: boardId as string,
      p_account_id: accountId,
    })
  const refused = await as(editor.id)
  expect(refused.error).toBeNull()
  expect(refused.data).toBe(false)
  expect(await boardExists(boardId as string)).toBe(true)

  const deleted = await as(owner.id)
  expect(deleted.error).toBeNull()
  expect(deleted.data).toBe(true)
  expect(await boardExists(boardId as string)).toBe(false)
})

test('account_deletion_plan classifies private, sole-owned shared, and shared Boards', async () => {
  const account = await user()
  const other = await user()
  const privateBoard = await currentBoardId(account.id)
  const { data: soleOwned } = await account.client.rpc('create_board', { board_name: 'Mine' })
  const { data: coOwned } = await account.client.rpc('create_board', { board_name: 'Ours' })
  await addMember(soleOwned as string, other, 'editor')
  await addMember(coOwned as string, other, 'owner')
  const othersBoard = await currentBoardId(other.id)
  await addMember(othersBoard, account, 'viewer')

  const byBoard = Object.fromEntries(
    (await plan(account.id)).map((r) => [r.board_id, r.disposition]),
  )
  expect(byBoard).toEqual({
    [privateBoard]: 'private',
    [soleOwned as string]: 'sole-owner-shared',
    [coOwned as string]: 'shared',
    [othersBoard]: 'shared',
  })
})

test('the plan agrees with the deletion trigger: refused while sole-owning, then private Boards go', async () => {
  const account = await user()
  const other = await user()
  const privateBoard = await currentBoardId(account.id)
  const { data: shared } = await account.client.rpc('create_board', { board_name: 'Shared' })
  await addMember(shared as string, other, 'editor')

  expect((await plan(account.id)).some((r) => r.disposition === 'sole-owner-shared')).toBe(true)
  const refused = await serviceClient().auth.admin.deleteUser(account.id)
  expect(refused.error).not.toBeNull()
  expect(await boardExists(privateBoard)).toBe(true)

  // Hand the shared Board a second Owner; now nothing blocks, and the trigger deletes exactly the
  // Boards the plan called private.
  await withPg((pg) =>
    pg.query(
      `update public.board_memberships set role = 'owner' where board_id = $1 and account_id = $2`,
      [shared, other.id],
    ),
  )
  const privateIds = (await plan(account.id))
    .filter((r) => r.disposition === 'private')
    .map((r) => r.board_id)
  expect(privateIds).toEqual([privateBoard])
  expect((await serviceClient().auth.admin.deleteUser(account.id)).error).toBeNull()
  expect(await boardExists(privateBoard)).toBe(false)
  expect(await boardExists(shared as string)).toBe(true)
})

test('only service_role may call the three commands', async () => {
  const owner = await user()
  const boardId = await currentBoardId(owner.id)
  for (const client of [anonClient(), owner.client]) {
    for (const call of [
      client.rpc('is_current_board_owner', { p_board_id: boardId, p_account_id: owner.id }),
      client.rpc('delete_board_as_owner', { p_board_id: boardId, p_account_id: owner.id }),
      client.rpc('account_deletion_plan', { p_account_id: owner.id }),
    ]) {
      expect((await call).error?.code).toBe('42501')
    }
  }
  expect(await boardExists(boardId)).toBe(true)
})
