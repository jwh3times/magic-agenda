/**
 * RFC 5545 serialization for the read-only calendar feed (#277).
 *
 * Pure: no network, no Supabase, no clock of its own. The feed's authorization — resolving a token
 * to a current Membership — belongs to the handler, and keeping it out of here is what lets the
 * whole mapping be tested under `deno test` with no stack running.
 *
 * **v1 exports Occurrences as literal events**, which is correct rather than merely simple: an
 * Occurrence is already a materialized row (ADR-0001), so there is no Rule to translate. RRULE and
 * EXDATE mapping is v2, and it changes what a Series looks like on disk, not what this does.
 *
 * Two choices here are deliberate and cheap to reverse if they read wrong in a real client:
 *
 * - **A timed Task gets no `DTEND`.** A Task due at 14:00 is a point in time, not a commitment of
 *   some invented length, and RFC 5545 §3.6.1 gives a DATE-TIME `DTSTART` with no end a zero
 *   duration. Some clients render a zero-length event as a marker rather than a block. Giving it a
 *   default half hour would look better and would be a fact nobody entered.
 * - **Everything timed is emitted as a UTC instant**, so the feed carries no `VTIMEZONE` block at
 *   all. Hand-written VTIMEZONE is a large surface to get subtly wrong for every past and future
 *   DST rule; `dueMomentAtZone` already resolves the wall clock to an instant the rest of the app
 *   agrees with, including through gaps and overlaps.
 *   The one exception is an Automatic Account Timezone (`null`), which has no zone to resolve
 *   through: it is emitted as floating local time, the RFC 5545 form that means "this wall clock,
 *   wherever you are" -- which is what Automatic means in the app.
 */
import { dueMomentAtZone } from "../../../src/data/dueMomentCore.ts";

/** One Occurrence, in app-domain terms: `day` is `null` for Inbox, never the `'inbox'` sentinel. */
export interface IcsTask {
  id: string;
  title: string;
  description: string | null;
  /** `YYYY-MM-DD`, or null when the Task is unscheduled. */
  day: string | null;
  /** `HH:MM`, or null for an untimed Task. */
  atTime: string | null;
}

export interface IcsOptions {
  calendarName: string;
  /**
   * The Account Timezone, an IANA name. An unusable one drops timed events rather than guessing.
   * `null` is Automatic -- follow the device -- and emits floating local time instead.
   */
  timezone: string | null;
  /** Injected so output is reproducible; defaults to now. */
  now?: Date;
  productId?: string;
}

const DEFAULT_PRODUCT_ID = "-//Magic Agenda//Board feed//EN";
const UID_DOMAIN = "magicagenda.app";
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MAX_OCTETS = 75;
const CLOCK_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * Escape a TEXT value per RFC 5545 §3.3.11.
 *
 * The comma is the one that bites: unescaped, it silently turns the value into a list, so
 * "Buy milk, eggs" reaches the calendar as "Buy milk". The colon is **not** escaped — it is only
 * special in a property's name/value separator, and escaping it puts stray backslashes into URLs.
 * Backslash goes first, or it would double the backslashes this function itself introduces.
 */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/**
 * Fold one logical line to 75 **octets** per RFC 5545 §3.1, continuations prefixed with a space.
 *
 * Counting characters instead of octets is the subtle version of this bug: it passes every ASCII
 * test and then splits a multi-byte sequence in a title with an accent or an emoji, so the client
 * shows a replacement character. The boundary is therefore chosen by measuring encoded length per
 * code point, never by slicing the string at an index.
 */
function foldLine(line: string): string[] {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= MAX_OCTETS) return [line];

  const out: string[] = [];
  let current = "";
  let octets = 0;
  // A continuation line spends one octet on its leading space.
  let limit = MAX_OCTETS;
  for (const char of line) {
    const size = encoder.encode(char).length;
    if (octets + size > limit) {
      out.push(current);
      current = "";
      octets = 0;
      limit = MAX_OCTETS - 1;
    }
    current += char;
    octets += size;
  }
  if (current !== "") out.push(current);
  return out.map((part, index) => (index === 0 ? part : ` ${part}`));
}

/** `YYYYMMDD`, the DATE form used by all-day events. */
function basicDate(day: string): string {
  return day.replace(/-/g, "");
}

/**
 * The day after `day`, as the DATE form.
 *
 * All-day `DTEND` is **exclusive**, so a one-day event ends on the following day. This is computed
 * through `Date.UTC` rather than by incrementing the string, which would produce 20261232 at a year
 * boundary and would need its own leap-year rule for February.
 */
function nextBasicDate(day: string): string | null {
  const match = DAY_RE.exec(day);
  if (!match) return null;
  const next = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) +
      86_400_000,
  );
  const year = String(next.getUTCFullYear()).padStart(4, "0");
  const month = String(next.getUTCMonth() + 1).padStart(2, "0");
  const date = String(next.getUTCDate()).padStart(2, "0");
  return `${year}${month}${date}`;
}

/** `YYYYMMDDTHHMMSSZ`, the UTC DATE-TIME form. */
function utcStamp(epochMs: number): string {
  return `${
    new Date(epochMs).toISOString().replace(/[-:]/g, "").slice(0, 15)
  }Z`;
}

function eventLines(
  task: IcsTask,
  timezone: string | null,
  stamp: string,
): string[] {
  if (task.day === null || !DAY_RE.test(task.day)) return [];

  const when: string[] = [];
  if (task.atTime === null) {
    const end = nextBasicDate(task.day);
    if (end === null) return [];
    when.push(
      `DTSTART;VALUE=DATE:${basicDate(task.day)}`,
      `DTEND;VALUE=DATE:${end}`,
    );
  } else if (timezone === null) {
    // Automatic: RFC 5545 §3.3.5 floating time, the same wall clock in whatever zone the calendar
    // is viewed in -- which is what "follow the device" means. It bypasses the zone resolver, so
    // the clock needs its own check or a malformed one would be pasted into DTSTART verbatim.
    const clock = CLOCK_RE.exec(task.atTime);
    if (clock === null) return [];
    when.push(`DTSTART:${basicDate(task.day)}T${clock[1]}${clock[2]}00`);
  } else {
    // A timed Task that cannot be resolved to an instant — an unusable timezone, or a wall clock
    // the zone does not have — is dropped rather than emitted at a guessed offset. A calendar
    // missing an event is a visible problem; one showing the wrong hour is not.
    const moment = dueMomentAtZone(task.day, task.atTime, timezone);
    if (moment === null || moment.kind !== "timed") return [];
    when.push(`DTSTART:${utcStamp(moment.instantMs)}`);
  }

  const lines = [
    "BEGIN:VEVENT",
    `UID:${task.id}@${UID_DOMAIN}`,
    `DTSTAMP:${stamp}`,
    ...when,
    `SUMMARY:${escapeText(task.title)}`,
  ];
  if (task.description !== null && task.description !== "") {
    lines.push(`DESCRIPTION:${escapeText(task.description)}`);
  }
  lines.push("END:VEVENT");
  return lines;
}

/**
 * Serialize Occurrences as an iCalendar document.
 *
 * A Task with no Scheduled Day is skipped: it has no Due Moment, and the alternative is putting a
 * moment nobody chose into someone's calendar. An empty result is still a valid, parseable
 * calendar — a subscriber with nothing scheduled should see no events, not a broken feed.
 */
export function tasksToIcs(
  tasks: readonly IcsTask[],
  options: IcsOptions,
): string {
  const stamp = utcStamp((options.now ?? new Date()).getTime());
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${options.productId ?? DEFAULT_PRODUCT_ID}`,
    "CALSCALE:GREGORIAN",
    `X-WR-CALNAME:${escapeText(options.calendarName)}`,
    ...tasks.flatMap((task) => eventLines(task, options.timezone, stamp)),
    "END:VCALENDAR",
  ];
  // A trailing CRLF terminates the last line, as every other line is terminated.
  return `${lines.flatMap(foldLine).join("\r\n")}\r\n`;
}
