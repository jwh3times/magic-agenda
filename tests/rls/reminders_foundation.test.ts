import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, expect, test } from 'vitest'
import {
  boardTaskInsert,
  createTestUser,
  currentBoardId,
  deleteTestUser,
  serviceClient,
  stack,
  type TestUser,
} from './helpers'

interface RestResult<T> {
  status: number
  body: T
}

async function authHeaders(user: TestUser): Promise<Record<string, string>> {
  const { data } = await user.client.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('test user has no access token')
  return { apikey: stack().anonKey, Authorization: `Bearer ${token}` }
}

async function rest<T>(
  path: string,
  init: RequestInit = {},
  headers: Record<string, string> = { apikey: stack().anonKey },
): Promise<RestResult<T>> {
  const response = await fetch(`${stack().apiUrl}/rest/v1/${path}`, {
    ...init,
    headers: { ...headers, ...init.headers },
  })
  const text = await response.text()
  return { status: response.status, body: text ? (JSON.parse(text) as T) : (null as T) }
}

let alice: TestUser
let bob: TestUser

beforeAll(async () => {
  alice = await createTestUser()
  bob = await createTestUser()
})

afterAll(async () => {
  if (alice) await deleteTestUser(alice)
  if (bob) await deleteTestUser(bob)
})

test('reminders start off and the deployed settings payload preserves that preference', async () => {
  const headers = await authHeaders(alice)
  const initial = await rest<{ reminder_lead_minutes: number | null }[]>(
    `user_settings?user_id=eq.${alice.id}&select=reminder_lead_minutes`,
    {},
    headers,
  )
  expect(initial.status).toBe(200)
  expect(initial.body).toEqual([{ reminder_lead_minutes: null }])

  const oldPayload = {
    user_id: alice.id,
    theme: 'glass',
    week_start: 1,
    timezone: 'America/New_York',
    keyboard_shortcuts: true,
  }
  const saved = await rest<unknown>('user_settings?on_conflict=user_id', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
      ...headers,
    },
    body: JSON.stringify(oldPayload),
  })
  expect(saved.status).toBe(200)

  const unchanged = await rest<{ reminder_lead_minutes: number | null }[]>(
    `user_settings?user_id=eq.${alice.id}&select=reminder_lead_minutes`,
    {},
    headers,
  )
  expect(unchanged.body).toEqual([{ reminder_lead_minutes: null }])
})

test('a reminder lead requires a concrete timezone and stays within one week', async () => {
  const headers = await authHeaders(bob)
  const patch = (body: object) =>
    rest<unknown>(`user_settings?user_id=eq.${bob.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal', ...headers },
      body: JSON.stringify(body),
    })

  expect((await patch({ reminder_lead_minutes: 15 })).status).toBe(400)
  expect((await patch({ timezone: 'Europe/London', reminder_lead_minutes: 15 })).status).toBe(204)
  expect((await patch({ reminder_lead_minutes: -1 })).status).toBe(400)
  expect((await patch({ reminder_lead_minutes: 10081 })).status).toBe(400)
  expect((await patch({ reminder_lead_minutes: null, timezone: null })).status).toBe(204)
})

test('push subscriptions are owner-scoped and support several devices', async () => {
  const aliceHeaders = await authHeaders(alice)
  const bobHeaders = await authHeaders(bob)
  const subscriptions = [
    {
      account_id: alice.id,
      endpoint: 'https://push.example.test/alice-phone',
      p256dh: 'phone-key',
      auth_secret: 'phone-secret',
    },
    {
      account_id: alice.id,
      endpoint: 'https://push.example.test/alice-laptop',
      p256dh: 'laptop-key',
      auth_secret: 'laptop-secret',
    },
  ]

  const inserted = await rest<{ id: string; endpoint: string }[]>('push_subscriptions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...aliceHeaders,
    },
    body: JSON.stringify(subscriptions),
  })
  expect(inserted.status).toBe(201)
  expect(inserted.body).toHaveLength(2)

  const bobRead = await rest<unknown[]>(
    `push_subscriptions?account_id=eq.${alice.id}&select=id`,
    {},
    bobHeaders,
  )
  expect(bobRead).toEqual({ status: 200, body: [] })

  const forged = await rest<unknown>('push_subscriptions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal', ...bobHeaders },
    body: JSON.stringify({ ...subscriptions[0], endpoint: 'https://push.example.test/forged' }),
  })
  expect(forged.status).toBe(403)

  const removed = await rest<unknown>(`push_subscriptions?id=eq.${inserted.body[0].id}`, {
    method: 'DELETE',
    headers: { Prefer: 'return=minimal', ...aliceHeaders },
  })
  expect(removed.status).toBe(204)
})

test('anonymous subscription reads filter to zero rows', async () => {
  const result = await rest<unknown[]>('push_subscriptions?select=id')
  expect(result).toEqual({ status: 200, body: [] })
})

test('the delivery ledger is server-managed and keyed by account, task, and due moment', async () => {
  const boardId = await currentBoardId(alice.id)
  const { data: task, error } = await alice.client
    .from('tasks')
    .insert(boardTaskInsert(boardId, { title: 'remind me', day: '2026-10-01', at_time: '09:00' }))
    .select('id')
    .single()
  expect(error).toBeNull()

  const enable = await alice.client
    .from('user_settings')
    .update({ timezone: 'America/New_York', reminder_lead_minutes: 15 })
    .eq('user_id', alice.id)
  expect(enable.error).toBeNull()

  const serviceCandidates = await serviceClient().rpc('reminder_candidate_rows')
  expect(serviceCandidates.error).toBeNull()
  expect(serviceCandidates.data).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        account_id: alice.id,
        board_id: boardId,
        task_id: task!.id,
        task_day: '2026-10-01',
        task_at_time: '09:00',
      }),
    ]),
  )
  const clientCandidates = await alice.client.rpc('reminder_candidate_rows')
  expect(clientCandidates.error?.code).toBe('42501')

  const headers = {
    apikey: stack().serviceKey,
    Authorization: `Bearer ${stack().serviceKey}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  }
  const dueMoment = '2026-10-01T13:00:00.000Z'
  const inserted = await rest<{ id: string }[]>(
    'reminder_deliveries',
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        account_id: alice.id,
        task_id: task!.id,
        due_moment: dueMoment,
        window_opens_at: '2026-10-01T12:45:00.000Z',
      }),
    },
    headers,
  )
  expect(inserted.status).toBe(201)

  const duplicate = await rest<unknown>(
    'reminder_deliveries',
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        account_id: alice.id,
        task_id: task!.id,
        due_moment: dueMoment,
        window_opens_at: '2026-10-01T12:45:00.000Z',
      }),
    },
    headers,
  )
  expect(duplicate.status).toBe(409)

  const aliceHeaders = await authHeaders(alice)
  const clientRead = await rest<unknown[]>('reminder_deliveries?select=id', {}, aliceHeaders)
  expect(clientRead).toEqual({ status: 200, body: [] })

  const clientWrite = await rest<unknown>('reminder_deliveries', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal', ...aliceHeaders },
    body: JSON.stringify({
      account_id: alice.id,
      task_id: task!.id,
      due_moment: '2026-10-01T14:00:00.000Z',
      window_opens_at: '2026-10-01T13:45:00.000Z',
    }),
  })
  expect(clientWrite.status).toBe(403)

  const serviceRows = await serviceClient().from('reminder_deliveries').select('id')
  expect(serviceRows.error).toBeNull()
  expect(serviceRows.data).toHaveLength(1)

  const subscription = await serviceClient()
    .from('push_subscriptions')
    .select('id')
    .eq('account_id', alice.id)
    .limit(1)
    .single()
  expect(subscription.error).toBeNull()
  const target = await serviceClient()
    .from('reminder_delivery_targets')
    .insert({
      delivery_id: inserted.body[0].id,
      subscription_id: subscription.data!.id,
      endpoint_hash: 'a'.repeat(43),
    })
    .select('id')
    .single()
  expect(target.error).toBeNull()

  const targetClientRead = await rest<unknown[]>(
    'reminder_delivery_targets?select=id',
    {},
    aliceHeaders,
  )
  expect(targetClientRead).toEqual({ status: 200, body: [] })
  const targetClientWrite = await rest<unknown>('reminder_delivery_targets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal', ...aliceHeaders },
    body: JSON.stringify({
      delivery_id: inserted.body[0].id,
      subscription_id: subscription.data!.id,
      endpoint_hash: 'b'.repeat(43),
    }),
  })
  expect(targetClientWrite.status).toBe(403)

  const now = new Date().toISOString()
  const attempts = await Promise.all(
    [randomUUID(), randomUUID()].map((token) =>
      serviceClient()
        .from('reminder_delivery_targets')
        .update({
          claim_token: token,
          claimed_at: now,
          claim_expires_at: new Date(Date.now() + 60_000).toISOString(),
        })
        .eq('id', target.data!.id)
        .or(`claim_expires_at.is.null,claim_expires_at.lt.${now}`)
        .select('id'),
    ),
  )
  expect(attempts.map((attempt) => attempt.data?.length).sort()).toEqual([0, 1])
})
