import { assertEquals } from 'jsr:@std/assert@1'
import type { ReminderCandidate } from './domain.ts'
import {
  type DeliveryClaim,
  PushFailure,
  type PushSubscriptionRow,
  type Recheck,
  type ReminderStore,
  runReminderSender,
  type TargetClaim,
} from './sender.ts'

const candidate: ReminderCandidate = {
  accountId: 'a1',
  boardId: 'b1',
  taskId: 't1',
  taskTitle: 'Report',
  timezone: 'UTC',
  leadMinutes: 15,
  dueMomentMs: Date.parse('2026-09-15T13:00:00Z'),
  windowOpensMs: Date.parse('2026-09-15T12:45:00Z'),
}
const subscription: PushSubscriptionRow = {
  id: 's1',
  endpoint: 'https://push.example.test/device',
  p256dh: 'key',
  authSecret: 'secret',
}

class MemoryStore implements ReminderStore {
  deliveryClaimed = false
  finished = false
  deleted = false
  recheckValue: Recheck = 'eligible'
  targetStatus: 'none' | 'pending' | 'succeeded' | 'dead' = 'none'
  attemptCount = 0
  nextAttemptMs = 0

  candidates(nowMs: number): Promise<ReminderCandidate[]> {
    const retry =
      this.targetStatus === 'pending' && this.attemptCount > 0 && nowMs >= this.nextAttemptMs
    return Promise.resolve(
      this.finished || (!retry && nowMs > candidate.dueMomentMs) ? [] : [candidate],
    )
  }
  claimDelivery(value: ReminderCandidate): Promise<DeliveryClaim | null> {
    if (this.deliveryClaimed || this.finished) return Promise.resolve(null)
    this.deliveryClaimed = true
    return Promise.resolve({ id: 'd1', candidate: value })
  }
  recheck(): Promise<Recheck> {
    return Promise.resolve(this.recheckValue)
  }
  suppress(): Promise<void> {
    this.finished = true
    this.deliveryClaimed = false
    return Promise.resolve()
  }
  subscriptions(): Promise<PushSubscriptionRow[]> {
    return Promise.resolve(this.deleted ? [] : [subscription])
  }
  ensureTargets(): Promise<boolean> {
    if (this.targetStatus === 'none') {
      if (this.deleted) return Promise.resolve(false)
      this.targetStatus = 'pending'
    }
    return Promise.resolve(true)
  }
  claimTargets(claim: DeliveryClaim, _token: string, nowMs: number): Promise<TargetClaim[]> {
    if (this.targetStatus !== 'pending' || nowMs < this.nextAttemptMs) {
      return Promise.resolve([])
    }
    if (this.deleted) {
      this.targetStatus = 'dead'
      return Promise.resolve([])
    }
    return Promise.resolve([
      {
        id: 'target-1',
        subscription,
        attemptCount: this.attemptCount,
      },
    ])
  }
  targetSucceeded(): Promise<void> {
    this.targetStatus = 'succeeded'
    this.attemptCount++
    return Promise.resolve()
  }
  targetRetry(
    _target: TargetClaim,
    _token: string,
    _status: number | null,
    _message: string,
    nowMs: number,
  ): Promise<void> {
    this.targetStatus = 'pending'
    this.attemptCount++
    this.nextAttemptMs = nowMs + 5 * 60_000
    return Promise.resolve()
  }
  targetDead(): Promise<void> {
    this.targetStatus = 'dead'
    this.attemptCount++
    return Promise.resolve()
  }
  deleteSubscription(): Promise<void> {
    this.deleted = true
    return Promise.resolve()
  }
  finalize(): Promise<void> {
    this.finished = this.targetStatus === 'succeeded' || this.targetStatus === 'dead'
    this.deliveryClaimed = false
    return Promise.resolve()
  }
  release(): Promise<void> {
    this.deliveryClaimed = false
    return Promise.resolve()
  }
}

Deno.test('concurrent senders produce one successful push', async () => {
  const store = new MemoryStore()
  let sends = 0
  const push = {
    send: () => {
      sends++
      return Promise.resolve()
    },
  }
  const now = candidate.windowOpensMs

  await Promise.all([runReminderSender(store, push, now), runReminderSender(store, push, now)])

  assertEquals(sends, 1)
  assertEquals(store.targetStatus, 'succeeded')
})

Deno.test('a transient failure retries only the pending target', async () => {
  const store = new MemoryStore()
  let sends = 0
  const push = {
    send: () => {
      sends++
      if (sends === 1) {
        return Promise.reject(new PushFailure('temporarily unavailable', 503))
      }
      return Promise.resolve()
    },
  }

  const first = await runReminderSender(store, push, candidate.windowOpensMs)
  const second = await runReminderSender(store, push, candidate.windowOpensMs + 5 * 60_000)
  const third = await runReminderSender(store, push, candidate.windowOpensMs + 6 * 60_000)

  assertEquals(first.retried, 1)
  assertEquals(second.delivered, 1)
  assertEquals(third.candidates, 0)
  assertEquals(sends, 2)
})

Deno.test('404 and 410 permanently retire a dead endpoint', async () => {
  for (const status of [404, 410]) {
    const store = new MemoryStore()
    let sends = 0
    const push = {
      send: () => {
        sends++
        return Promise.reject(new PushFailure('gone', status))
      },
    }
    const result = await runReminderSender(store, push, candidate.windowOpensMs)
    await runReminderSender(store, push, candidate.windowOpensMs + 5 * 60_000)

    assertEquals(result.dead, 1)
    assertEquals(store.deleted, true)
    assertEquals(sends, 1)
  }
})

Deno.test('a removed subscription cannot hold a retry delivery open', async () => {
  const store = new MemoryStore()
  let sends = 0
  const push = {
    send: () => {
      sends++
      return Promise.reject(new PushFailure('temporarily unavailable', 503))
    },
  }
  await runReminderSender(store, push, candidate.windowOpensMs)
  store.deleted = true
  await runReminderSender(store, push, candidate.windowOpensMs + 5 * 60_000)
  const after = await runReminderSender(store, push, candidate.windowOpensMs + 6 * 60_000)

  assertEquals(sends, 1)
  assertEquals(store.targetStatus, 'dead')
  assertEquals(after.candidates, 0)
})

Deno.test('completion is rechecked after the delivery claim', async () => {
  const store = new MemoryStore()
  store.recheckValue = 'completed'
  let sends = 0

  await runReminderSender(
    store,
    {
      send: () => {
        sends++
        return Promise.resolve()
      },
    },
    candidate.windowOpensMs,
  )

  assertEquals(sends, 0)
  assertEquals(store.finished, true)
})
