import { assertEquals } from "jsr:@std/assert@1";
import {
  planReminderCandidates,
  type ReminderPairing,
  type ReminderPreference,
  type ReminderTask,
} from "./domain.ts";

const TASK: ReminderTask = {
  id: "t1",
  boardId: "b1",
  title: "Report",
  day: "2026-09-15",
  atTime: "09:00",
  status: "todo",
  recurFreq: "none",
  recurParentId: null,
  updatedAtMs: Date.parse("2026-09-14T12:00:00Z"),
};

/** Pairs every given Account with every given Task, as one Board would. */
const inputs = (
  overrides: {
    preferences?: ReminderPreference[];
    tasks?: ReminderTask[];
  } = {},
): ReminderPairing[] => {
  const preferences = overrides.preferences ?? [{
    accountId: "a1",
    timezone: "America/New_York",
    leadMinutes: 15,
  }];
  return preferences.flatMap((preference) =>
    (overrides.tasks ?? [TASK]).map((task) => ({ preference, task }))
  );
};

Deno.test("shared Board members receive Account-specific Due Moments", () => {
  const planned = planReminderCandidates(
    inputs({
      preferences: [
        { accountId: "ny", timezone: "America/New_York", leadMinutes: 15 },
        { accountId: "la", timezone: "America/Los_Angeles", leadMinutes: 15 },
      ],
    }),
    Date.parse("2026-09-15T12:45:00Z"),
  );
  assertEquals(planned.map((candidate) => candidate.accountId), ["ny"]);
  assertEquals(planned[0].dueMomentMs, Date.parse("2026-09-15T13:00:00Z"));
});

Deno.test("untimed Tasks open relative to next local midnight", () => {
  const planned = planReminderCandidates(
    inputs({
      preferences: [{ accountId: "a1", timezone: "UTC", leadMinutes: 60 }],
      tasks: [{ ...TASK, atTime: null }],
    }),
    Date.parse("2026-09-15T23:00:00Z"),
  );
  assertEquals(planned[0].dueMomentMs, Date.parse("2026-09-16T00:00:00Z"));
});

Deno.test("Inbox, Completed, and Series definition rows are never eligible", () => {
  const planned = planReminderCandidates(
    inputs({
      tasks: [
        { ...TASK, id: "inbox", day: null },
        { ...TASK, id: "done", status: "done" },
        { ...TASK, id: "series", recurFreq: "daily", recurParentId: null },
      ],
    }),
    Date.parse("2026-09-15T12:45:00Z"),
  );
  assertEquals(planned, []);
});

Deno.test("DST gap and overlap use the client-compatible instant", () => {
  const spring = planReminderCandidates(
    inputs({
      preferences: [{
        accountId: "a1",
        timezone: "America/New_York",
        leadMinutes: 0,
      }],
      tasks: [{ ...TASK, day: "2026-03-08", atTime: "02:30" }],
    }),
    Date.parse("2026-03-08T07:30:00Z"),
  );
  const fall = planReminderCandidates(
    inputs({
      preferences: [{
        accountId: "a1",
        timezone: "America/New_York",
        leadMinutes: 0,
      }],
      tasks: [{ ...TASK, day: "2026-11-01", atTime: "01:30" }],
    }),
    Date.parse("2026-11-01T05:30:00Z"),
  );
  assertEquals(spring[0].dueMomentMs, Date.parse("2026-03-08T07:30:00Z"));
  assertEquals(fall[0].dueMomentMs, Date.parse("2026-11-01T05:30:00Z"));
});

Deno.test("at-Due-Moment delivery allows one scheduler interval of grace", () => {
  const planned = planReminderCandidates(
    inputs({
      preferences: [{ accountId: "a1", timezone: "UTC", leadMinutes: 0 }],
      tasks: [{ ...TASK, atTime: "13:00" }],
    }),
    Date.parse("2026-09-15T13:04:00Z"),
  );
  assertEquals(planned.length, 1);
});

Deno.test("a Task reopened after its Due Moment does not replay a missed Reminder", () => {
  assertEquals(
    planReminderCandidates(
      inputs({
        preferences: [{ accountId: "a1", timezone: "UTC", leadMinutes: 0 }],
        tasks: [{
          ...TASK,
          atTime: "13:00",
          updatedAtMs: Date.parse("2026-09-15T13:01:00Z"),
        }],
      }),
      Date.parse("2026-09-15T13:04:00Z"),
    ),
    [],
  );
});
