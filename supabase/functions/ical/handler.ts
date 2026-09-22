import { tasksToIcs } from "../_shared/ics.ts";

/** What `public.ical_feed(p_token)` returns for a current Membership's token. */
export interface Feed {
  board_name: string;
  /** The Account Timezone; `null` is Automatic. */
  timezone: string | null;
  tasks: {
    id: string;
    title: string;
    description: string | null;
    day: string;
    at_time: string | null;
  }[];
}

export interface HandlerDependencies {
  /** Resolves a token to its Board's feed, or `null` when it names no current Membership. */
  loadFeed: (token: string) => Promise<Feed | null>;
  now: () => Date;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Serves one Board as a read-only iCalendar feed, to anyone holding its URL (#277).
 *
 * **The token is a capability, and this endpoint is deliberately unauthenticated.** A calendar
 * client cannot sign in, so whoever holds the URL reads the Board: there is no second factor,
 * clients store the URL in plaintext, and rotation (`rotate_ical_token`) is the only revocation
 * short of ending the Membership. `verify_jwt = false` in `config.toml` is therefore correct here
 * and would be wrong almost anywhere else.
 *
 * **The authorization is not in this file.** `ical_feed` resolves the token to a Membership with
 * `ended_at is null` in SQL, and returns NULL for an unknown token and a revoked one alike -- so
 * this handler cannot distinguish them, and every refusal is the same 404. What the handler owns is
 * the gate in front of that call: only GET and HEAD, and a malformed token never reaches the
 * database at all.
 *
 * **The token never appears in a log line.** Supabase retains function logs, and a line carrying
 * the token would make log access Board access. A failure logs its kind, never its message, since
 * a client library's message may echo the request.
 */
export function createHandler(deps: HandlerDependencies) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: { Allow: "GET, HEAD", "Cache-Control": "no-store" },
      });
    }

    // Exactly one well-formed token, or the same 404 an unknown token gets.
    const tokens = new URL(request.url).searchParams.getAll("token");
    if (tokens.length !== 1 || !UUID_RE.test(tokens[0])) return notFound();

    let feed: Feed | null;
    try {
      feed = await deps.loadFeed(tokens[0]);
    } catch (cause) {
      console.error("ical: feed lookup failed", describe(cause));
      return new Response("Feed unavailable", {
        status: 500,
        headers: { "Cache-Control": "no-store" },
      });
    }
    if (feed === null) return notFound();

    const body = tasksToIcs(
      feed.tasks.map((task) => ({
        id: task.id,
        title: task.title,
        description: task.description,
        day: task.day,
        atTime: task.at_time,
      })),
      {
        calendarName: feed.board_name,
        timezone: feed.timezone,
        now: deps.now(),
      },
    );

    return new Response(request.method === "HEAD" ? null : body, {
      status: 200,
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        // Calendar clients poll aggressively. `private` because this is one capability's view of
        // one Board, which no shared cache should hold.
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
      },
    });
  };
}

function notFound(): Response {
  // `no-store`: a revoked URL must not keep being answered from a cache, and a newly issued one
  // must not be shadowed by a remembered 404.
  return new Response("Not Found", {
    status: 404,
    headers: { "Cache-Control": "no-store" },
  });
}

/** A failure's kind -- name and code -- with its message deliberately left out. */
function describe(cause: unknown): string {
  if (cause instanceof Error) {
    const code = (cause as { code?: unknown }).code;
    return typeof code === "string" ? `${cause.name} ${code}` : cause.name;
  }
  if (cause && typeof cause === "object" && "code" in cause) {
    return `code ${String((cause as { code: unknown }).code)}`;
  }
  return typeof cause;
}
