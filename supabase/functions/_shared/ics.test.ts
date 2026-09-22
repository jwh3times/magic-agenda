import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { type IcsTask, tasksToIcs } from "./ics.ts";

const AT = new Date("2026-09-22T12:00:00Z");

function task(overrides: Partial<IcsTask> = {}): IcsTask {
  return {
    id: "t1",
    title: "Write the thing",
    description: null,
    day: "2026-09-22",
    atTime: null,
    ...overrides,
  };
}

function ics(tasks: IcsTask[], timezone: string | null = "UTC"): string {
  return tasksToIcs(tasks, { calendarName: "My Board", timezone, now: AT });
}

/** Unfold per RFC 5545 §3.1, so assertions can read logical lines. */
function logicalLines(text: string): string[] {
  return text.split("\r\n").reduce<string[]>((lines, line) => {
    if (line.startsWith(" ") && lines.length > 0) {
      lines[lines.length - 1] += line.slice(1);
      return lines;
    }
    lines.push(line);
    return lines;
  }, []);
}

Deno.test("the calendar wrapper is well formed and CRLF terminated", () => {
  const text = ics([task()]);
  // CRLF is required by RFC 5545, and a bare LF is the kind of thing that reads fine in a diff
  // and is rejected by a strict parser.
  assertEquals(text.includes("\n") && !text.includes("\r\n\r\n\r\n"), true);
  assertEquals(
    text.split("\n").every((l) => l === "" || l.endsWith("\r")),
    true,
  );
  const lines = logicalLines(text);
  assertEquals(lines[0], "BEGIN:VCALENDAR");
  assertStringIncludes(text, "VERSION:2.0");
  assertStringIncludes(text, "CALSCALE:GREGORIAN");
  assertEquals(lines.filter((l) => l === "BEGIN:VEVENT").length, 1);
  assertEquals(lines.filter((l) => l === "END:VEVENT").length, 1);
  assertEquals(lines.at(-2), "END:VCALENDAR");
});

Deno.test("an untimed Task is an all-day event whose DTEND is the NEXT day", () => {
  // The exclusive end is the classic off-by-one here: DTEND equal to DTSTART renders as a
  // zero-length all-day event, and DTEND one day short hides the last day of a range.
  const lines = logicalLines(ics([task({ day: "2026-09-22" })]));
  assertEquals(lines.includes("DTSTART;VALUE=DATE:20260922"), true);
  assertEquals(lines.includes("DTEND;VALUE=DATE:20260923"), true);
});

Deno.test("the all-day end rolls over a month and a year boundary", () => {
  // Naive string arithmetic on the day gets 20261232 here, which parses as garbage or throws.
  const endOfYear = logicalLines(ics([task({ day: "2026-12-31" })]));
  assertEquals(endOfYear.includes("DTEND;VALUE=DATE:20270101"), true);
  const endOfMonth = logicalLines(ics([task({ id: "t2", day: "2026-02-28" })]));
  assertEquals(endOfMonth.includes("DTEND;VALUE=DATE:20260301"), true);
  // 2028 is a leap year, so the 28th is not the end of February.
  const leap = logicalLines(ics([task({ id: "t3", day: "2028-02-28" })]));
  assertEquals(leap.includes("DTEND;VALUE=DATE:20280229"), true);
});

Deno.test("a timed Task becomes a UTC instant derived from the account timezone", () => {
  // Emitting UTC is what lets the feed carry no VTIMEZONE block at all. 09:30 in New York on this
  // date is 13:30Z; a naive implementation that pasted the wall clock in would emit 093000Z and be
  // wrong by the offset for every subscriber.
  const lines = logicalLines(
    ics([task({ day: "2026-09-22", atTime: "09:30" })], "America/New_York"),
  );
  assertEquals(lines.includes("DTSTART:20260922T133000Z"), true);
  // No DTEND: a Task due at a time is a point, not a commitment of some invented length.
  assertEquals(lines.some((l) => l.startsWith("DTEND")), false);
});

Deno.test("a timed Task on a DST spring-forward day is still a real instant", () => {
  // 02:30 does not exist in New York on 2026-03-08. The shared core resolves forward through the
  // gap rather than returning nothing, and the feed must carry that instant rather than drop the
  // event or emit an impossible one.
  const lines = logicalLines(
    ics([task({ day: "2026-03-08", atTime: "02:30" })], "America/New_York"),
  );
  const start = lines.find((l) => l.startsWith("DTSTART:"));
  assertEquals(typeof start, "string");
  assertEquals(/^DTSTART:\d{8}T\d{6}Z$/.test(start!), true);
});

Deno.test("an Automatic timezone emits floating local time, not a dropped event", () => {
  // `timezone is null` is the Account choosing Automatic -- follow the device. RFC 5545 §3.3.5
  // floating time (no `Z`, no `TZID`) means exactly that: the same wall clock in whatever zone the
  // calendar is viewed in. Dropping these, as an unusable zone is dropped, would silently empty the
  // timed half of the feed for every Account that never picked a zone.
  const lines = logicalLines(
    ics([task({ day: "2026-09-22", atTime: "09:30" })], null),
  );
  assertEquals(lines.includes("DTSTART:20260922T093000"), true);
  assertEquals(lines.some((l) => l.startsWith("DTEND")), false);
  // Untimed Tasks never depended on a zone, and still do not.
  const allDay = logicalLines(ics([task({ id: "t2", atTime: null })], null));
  assertEquals(allDay.includes("DTSTART;VALUE=DATE:20260922"), true);
});

Deno.test("an Automatic timezone still refuses a malformed wall clock", () => {
  // Floating time skips the zone resolver, which is also what validated the clock. Without its
  // own check, "9:3" would be pasted into DTSTART as an unparseable value.
  const lines = logicalLines(ics([task({ atTime: "9:3" })], null));
  assertEquals(lines.filter((l) => l === "BEGIN:VEVENT").length, 0);
});

Deno.test("TEXT values escape backslash, semicolon, comma and newline — and not the colon", () => {
  // Per RFC 5545 §3.3.11. An unescaped comma silently splits the value into a list, so a title
  // like "Buy milk, eggs" arrives in the calendar as "Buy milk".
  const lines = logicalLines(
    ics([
      task({
        title: "Buy milk, eggs; not C:\\temp",
        description: "first\nsecond",
      }),
    ]),
  );
  assertEquals(
    lines.includes("SUMMARY:Buy milk\\, eggs\\; not C:\\\\temp"),
    true,
  );
  assertEquals(lines.includes("DESCRIPTION:first\\nsecond"), true);
});

Deno.test("long lines fold at 75 octets with a single leading space", () => {
  const long = "x".repeat(300);
  const text = ics([task({ title: long })]);
  for (const line of text.split("\r\n")) {
    assertEquals(
      new TextEncoder().encode(line).length <= 75,
      true,
      `line longer than 75 octets: ${line.slice(0, 40)}…`,
    );
  }
  // Unfolding has to give the value back exactly, or folding corrupted it.
  assertEquals(logicalLines(text).includes(`SUMMARY:${long}`), true);
});

Deno.test("folding counts octets, and never splits a multi-byte character", () => {
  // The bug this pins: folding on string length puts the boundary mid-sequence for non-ASCII
  // titles, and the client shows a replacement character. Each of these is 4 UTF-8 octets.
  const emoji = "🙂".repeat(60);
  const text = ics([task({ title: emoji })]);
  for (const line of text.split("\r\n")) {
    assertEquals(new TextEncoder().encode(line).length <= 75, true);
  }
  assertEquals(text.includes("\uFFFD"), false);
  assertEquals(logicalLines(text).includes(`SUMMARY:${emoji}`), true);
});

Deno.test("an Inbox Task is skipped, because it has no Due Moment", () => {
  // The app rule, not an ics rule: an unscheduled Task has no moment to place on a calendar, and
  // inventing one would put a lie in someone's calendar.
  const text = ics([task({ id: "t1", day: null }), task({ id: "t2" })]);
  const lines = logicalLines(text);
  assertEquals(lines.filter((l) => l === "BEGIN:VEVENT").length, 1);
  assertStringIncludes(text, "UID:t2@magicagenda.app");
});

Deno.test("a Task whose day or timezone cannot be resolved is skipped, not emitted broken", () => {
  assertEquals(
    logicalLines(ics([task({ day: "not-a-day" })])).filter((l) =>
      l === "BEGIN:VEVENT"
    ).length,
    0,
  );
  assertEquals(
    logicalLines(ics([task({ atTime: "09:30" })], "Not/AZone")).filter((l) =>
      l === "BEGIN:VEVENT"
    )
      .length,
    0,
  );
});

Deno.test("UID is stable and derived from the Task id", () => {
  // A UID that changed between polls would make every client duplicate the event instead of
  // updating it.
  const first = logicalLines(ics([task()])).find((l) => l.startsWith("UID:"));
  const second = logicalLines(ics([task()])).find((l) => l.startsWith("UID:"));
  assertEquals(first, "UID:t1@magicagenda.app");
  assertEquals(first, second);
});

Deno.test("the calendar name is carried, and escaped like any other TEXT value", () => {
  const text = tasksToIcs([], {
    calendarName: "Work, Home",
    timezone: "UTC",
    now: AT,
  });
  assertStringIncludes(text, "X-WR-CALNAME:Work\\, Home");
  // An empty feed is still a valid calendar, not an empty string: a client that fetches one
  // should see "no events", not a parse error.
  assertStringIncludes(text, "BEGIN:VCALENDAR");
  assertEquals(
    logicalLines(text).filter((l) => l === "BEGIN:VEVENT").length,
    0,
  );
});

Deno.test("DTSTAMP comes from the injected clock, so output is reproducible", () => {
  assertEquals(
    logicalLines(ics([task()])).includes("DTSTAMP:20260922T120000Z"),
    true,
  );
});
