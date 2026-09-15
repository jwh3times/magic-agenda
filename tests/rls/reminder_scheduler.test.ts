import { expect, test } from 'vitest'
import { withPg } from './helpers'

test('the Reminder scheduler runs every five minutes without embedding credentials', async () => {
  const result = await withPg((pg) =>
    pg.query<{ schedule: string; command: string }>(
      `select schedule, command from cron.job where jobname = 'send-task-reminders'`,
    ),
  )

  expect(result.rows).toHaveLength(1)
  expect(result.rows[0].schedule).toBe('*/5 * * * *')
  expect(result.rows[0].command).toContain("name = 'reminder_function_url'")
  expect(result.rows[0].command).toContain("name = 'reminder_cron_secret'")
  expect(result.rows[0].command).not.toMatch(/https:\/\//)
  expect(result.rows[0].command).not.toMatch(/Bearer [A-Za-z0-9_-]{20,}/)
})
