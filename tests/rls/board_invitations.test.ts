import { createHash, randomBytes } from 'node:crypto'
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
 * Board Invitations at the database boundary (#436). Everything here ships dark: no UI calls these
 * commands yet (#437), and they must hold with the `board-sharing` flag off.
 *
 * The property the whole design rests on is that a token is **not** a bearer credential: acceptance
 * requires the caller's verified Account email to equal the one invited. The refusal tests are each
 * paired with a success that proves the fixture could have succeeded.
 */

const everyone: TestUser[] = []
async function user(): Promise<TestUser> {
  const created = await createTestUser()
  everyone.push(created)
  return created
}

let owner: TestUser
let editor: TestUser
let boardId: string

const create = (as: TestUser, email: string, role = 'editor', board = boardId) =>
  as.client.rpc('create_invitation', { p_board_id: board, p_email: email, p_role: role })

async function invite(email: string, role = 'editor'): Promise<string> {
  const { data, error } = await create(owner, email, role)
  if (error) throw new Error(`create_invitation failed: ${error.message}`)
  return data
}

async function invitationRow(token: string) {
  return withPg(async (pg) => {
    const { rows } = await pg.query<{
      id: string
      status: string
      target_email: string | null
      role: string
      responded_at: string | null
      accepted_by: string | null
    }>(
      `select id, status, target_email, role, responded_at, accepted_by
         from public.board_invitations where token_hash = sha256(convert_to($1, 'UTF8'))`,
      [token],
    )
    return rows[0]
  })
}

/** Inserts invitation rows directly, for the caps and retention cases. */
async function seed(rows: { status: string; createdAgo?: string; respondedAgo?: string }[]) {
  await withPg(async (pg) => {
    for (const row of rows) {
      await pg.query(
        `insert into public.board_invitations
           (board_id, invited_by, target_email, role, token_hash, status, created_at, responded_at)
         values ($1, $2, $3, 'viewer', $4, $5,
                 now() - $6::interval,
                 case when $5 = 'pending' then null else now() - $7::interval end)`,
        [
          boardId,
          owner.id,
          `seed-${randomBytes(6).toString('hex')}@example.test`,
          createHash('sha256').update(randomBytes(32)).digest(),
          row.status,
          row.createdAgo ?? '0 seconds',
          row.respondedAgo ?? '0 seconds',
        ],
      )
    }
  })
}

const clearInvitations = () =>
  withPg((pg) => pg.query('delete from public.board_invitations where board_id = $1', [boardId]))

beforeAll(async () => {
  owner = await user()
  editor = await user()
  boardId = await currentBoardId(owner.id)
  await withPg((pg) =>
    pg.query(
      `insert into public.board_memberships (board_id, account_id, role) values ($1, $2, 'editor')`,
      [boardId, editor.id],
    ),
  )
  const { error } = await owner.client
    .from('account_profiles')
    .update({ display_name: 'Olive Owner' })
    .eq('account_id', owner.id)
  if (error) throw new Error(error.message)
})

afterAll(async () => {
  await withPg((pg) =>
    pg.query(
      `update public.board_memberships set ended_at = now(), end_reason = 'removed'
        where account_id = any($1) and ended_at is null and role <> 'owner'`,
      [everyone.map((u) => u.id)],
    ),
  )
  for (const created of everyone) await deleteTestUser(created)
})

test('an Owner gets a one-time token; only its SHA-256 hash is stored', async () => {
  const invitee = await user()
  const token = await invite(`  ${invitee.email.toUpperCase()} `)
  expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/) // 32 bytes, base64url, unpadded

  const row = await invitationRow(token)
  expect(row).toMatchObject({ status: 'pending', role: 'editor', target_email: invitee.email })
  // The token itself appears in no column.
  const stored = await withPg(async (pg) => {
    const { rows } = await pg.query(`select * from public.board_invitations where id = $1`, [
      row.id,
    ])
    return JSON.stringify(rows[0])
  })
  expect(stored).not.toContain(token)
})

test('only a current Owner can invite, and a non-member learns nothing', async () => {
  const outsider = await user()
  expect((await create(editor, 'x@example.test')).error?.message).toBe('not-owner')
  expect((await create(outsider, 'x@example.test')).error?.message).toBe('membership-ended')
})

test('a malformed email, an unknown role, and Owner as a role are refused', async () => {
  expect((await create(owner, 'not-an-email')).error?.message).toBe('invalid-email')
  expect((await create(owner, 'a@b.c', 'admin')).error?.message).toBe('invalid-role')
  // Ownership is reached by promotion after joining, never handed out by link.
  expect((await create(owner, 'a@b.c', 'owner')).error?.message).toBe('invalid-role')
})

test('an existing member, and a second pending invitation for one email, are refused', async () => {
  expect((await create(owner, editor.email)).error?.message).toBe('already-member')
  const invitee = await user()
  await invite(invitee.email)
  expect((await create(owner, invitee.email.toUpperCase())).error?.message).toBe('already-invited')
})

test('the invitee previews, then accepts, and becomes a member in the offered role', async () => {
  const invitee = await user()
  const token = await invite(invitee.email, 'viewer')

  const preview = await invitee.client.rpc('invitation_preview', { p_token: token })
  expect(preview.error).toBeNull()
  expect(preview.data).toEqual([
    expect.objectContaining({ inviter_name: 'Olive Owner', role: 'viewer' }),
  ])
  expect((preview.data as { board_name: string }[])[0].board_name).toBeTruthy()

  const accepted = await invitee.client.rpc('accept_invitation', { p_token: token })
  expect(accepted.error).toBeNull()
  expect(accepted.data).toBe(boardId)
  const { data: boards } = await invitee.client.from('boards').select('id').eq('id', boardId)
  expect(boards).toEqual([{ id: boardId }])
  expect(await invitationRow(token)).toMatchObject({ status: 'accepted', accepted_by: invitee.id })
  const role = await withPg(async (pg) => {
    const { rows } = await pg.query<{ role: string }>(
      `select role from public.board_memberships
        where board_id = $1 and account_id = $2 and ended_at is null`,
      [boardId, invitee.id],
    )
    return rows[0]?.role
  })
  expect(role).toBe('viewer')

  // Single use.
  expect((await invitee.client.rpc('accept_invitation', { p_token: token })).error?.message).toBe(
    'invitation-unavailable',
  )
})

test('the token is useless to anyone whose verified email is not the one invited', async () => {
  const invitee = await user()
  const somebody = await user()
  const token = await invite(invitee.email)

  for (const fn of ['invitation_preview', 'accept_invitation', 'decline_invitation'] as const) {
    expect((await somebody.client.rpc(fn, { p_token: token })).error?.message).toBe(
      'email-mismatch',
    )
  }
  expect(await invitationRow(token)).toMatchObject({ status: 'pending' })
  const { data } = await somebody.client.from('boards').select('id').eq('id', boardId)
  expect(data).toEqual([])
})

test('an unverified email cannot accept, even when it matches', async () => {
  const invitee = await user()
  const token = await invite(invitee.email)
  await withPg((pg) =>
    pg.query('update auth.users set email_confirmed_at = null where id = $1', [invitee.id]),
  )
  expect((await invitee.client.rpc('accept_invitation', { p_token: token })).error?.message).toBe(
    'email-unverified',
  )
  await withPg((pg) =>
    pg.query('update auth.users set email_confirmed_at = now() where id = $1', [invitee.id]),
  )
  expect((await invitee.client.rpc('accept_invitation', { p_token: token })).error).toBeNull()
})

test('declining settles the invitation; it cannot be accepted afterwards', async () => {
  const invitee = await user()
  const token = await invite(invitee.email)
  expect((await invitee.client.rpc('decline_invitation', { p_token: token })).error).toBeNull()
  expect(await invitationRow(token)).toMatchObject({ status: 'declined' })
  expect((await invitee.client.rpc('accept_invitation', { p_token: token })).error?.message).toBe(
    'invitation-unavailable',
  )
})

test('only an Owner revokes; a revoked invitation cannot be accepted', async () => {
  const invitee = await user()
  const token = await invite(invitee.email)
  const { id } = await invitationRow(token)
  expect(
    (await editor.client.rpc('revoke_invitation', { p_invitation_id: id })).error?.message,
  ).toBe('not-owner')
  expect((await owner.client.rpc('revoke_invitation', { p_invitation_id: id })).error).toBeNull()
  expect((await invitee.client.rpc('accept_invitation', { p_token: token })).error?.message).toBe(
    'invitation-unavailable',
  )
  // Revoking twice is refused as such, not repeated.
  expect(
    (await owner.client.rpc('revoke_invitation', { p_invitation_id: id })).error?.message,
  ).toBe('invitation-unavailable')
})

test('an unknown token is unavailable, not an error of another kind', async () => {
  const invitee = await user()
  const { error } = await invitee.client.rpc('accept_invitation', { p_token: 'no-such-token' })
  expect(error?.message).toBe('invitation-unavailable')
})

test('an expired invitation is refused, and the daily job marks it expired', async () => {
  const invitee = await user()
  const token = await invite(invitee.email)
  await withPg((pg) =>
    pg.query(
      `update public.board_invitations set expires_at = now() - interval '1 minute'
        where token_hash = sha256(convert_to($1, 'UTF8'))`,
      [token],
    ),
  )
  expect((await invitee.client.rpc('accept_invitation', { p_token: token })).error?.message).toBe(
    'invitation-expired',
  )
  await withPg((pg) => pg.query('select public.expire_board_invitations()'))
  const row = await invitationRow(token)
  expect(row.status).toBe('expired')
  expect(row.responded_at).not.toBeNull()
  // Expiry frees the email for a fresh invitation.
  expect((await create(owner, invitee.email)).error).toBeNull()
})

test('retention removes the email of a terminal invitation after 30 days, and only then', async () => {
  await clearInvitations()
  await seed([
    { status: 'accepted', respondedAgo: '31 days' },
    { status: 'revoked', respondedAgo: '29 days' },
    { status: 'pending' },
  ])
  await withPg((pg) => pg.query('select public.expire_board_invitations()'))
  const rows = await withPg(async (pg) => {
    const { rows } = await pg.query<{ status: string; has_email: boolean }>(
      `select status, target_email is not null as has_email from public.board_invitations
        where board_id = $1 order by status`,
      [boardId],
    )
    return rows
  })
  expect(rows).toEqual([
    { status: 'accepted', has_email: false },
    { status: 'pending', has_email: true },
    { status: 'revoked', has_email: true },
  ])
})

test('a Board holds at most 20 pending invitations, and the cap holds under a race', async () => {
  await clearInvitations()
  await seed(Array.from({ length: 19 }, () => ({ status: 'pending' })))
  // Two independent sessions of the Owner. Checked against a mutation: with the Board lock removed
  // and a sleep placed between the count and the insert, both calls succeed and this test fails.
  // (A sleep placed *instead of* the lock proves nothing — both calls sleep side by side and then
  // run the count-and-insert a few milliseconds apart, never overlapping.)
  const second = anonClient()
  const signIn = await second.auth.signInWithPassword({
    email: owner.email,
    password: owner.password,
    options: { captchaToken: 'XXXX.DUMMY.TOKEN.XXXX' },
  })
  if (signIn.error) throw new Error(signIn.error.message)
  const results = await Promise.all([
    create(owner, 'race-one@example.test'),
    second.rpc('create_invitation', {
      p_board_id: boardId,
      p_email: 'race-two@example.test',
      p_role: 'editor',
    }),
  ])
  expect(results.filter((r) => r.error).map((r) => r.error?.message)).toEqual(['too-many-pending'])
  expect((await create(owner, 'one-more@example.test')).error?.message).toBe('too-many-pending')
})

test('an Account creates at most 50 invitations in any rolling 24 hours', async () => {
  await clearInvitations()
  // Terminal rows, so the per-Board pending cap is not what refuses.
  await seed(Array.from({ length: 50 }, () => ({ status: 'revoked', createdAgo: '1 hour' })))
  expect((await create(owner, 'fifty-first@example.test')).error?.message).toBe('rate-limited')
  // Outside the window they no longer count.
  await withPg((pg) =>
    pg.query(
      `update public.board_invitations set created_at = now() - interval '25 hours'
        where board_id = $1`,
      [boardId],
    ),
  )
  expect((await create(owner, 'fifty-first@example.test')).error).toBeNull()
})

test('only the Board’s Owners can read its invitations', async () => {
  await clearInvitations()
  const invitee = await user()
  await invite(invitee.email)
  const read = async (client: TestUser['client']) =>
    (await client.from('board_invitations').select('target_email').eq('board_id', boardId)).data
  expect(await read(owner.client)).toEqual([{ target_email: invitee.email }])
  expect(await read(editor.client)).toEqual([])
  expect(await read(invitee.client)).toEqual([])
  expect(await read(anonClient())).toEqual([])
})

test('nobody writes the table directly', async () => {
  const { error } = await owner.client.from('board_invitations').insert({
    board_id: boardId,
    target_email: 'x@example.test',
    role: 'viewer',
    token_hash: '\\x00',
  })
  expect(error?.code).toBe('42501')
})

test('anon and service_role cannot call the commands', async () => {
  for (const client of [anonClient(), serviceClient()]) {
    for (const call of [
      client.rpc('create_invitation', { p_board_id: boardId, p_email: 'a@b.c', p_role: 'viewer' }),
      client.rpc('accept_invitation', { p_token: 'x' }),
      client.rpc('invitation_preview', { p_token: 'x' }),
    ]) {
      expect((await call).error?.code).toBe('42501')
    }
  }
})

test('the retention job is scheduled daily', async () => {
  const job = await withPg(async (pg) => {
    const { rows } = await pg.query<{ schedule: string; command: string }>(
      `select schedule, command from cron.job where jobname = 'expire-board-invitations'`,
    )
    return rows[0]
  })
  expect(job.schedule).toBe('41 3 * * *')
  expect(job.command).toContain('public.expire_board_invitations()')
})
