import {
  type PushTransport,
  type ReminderStore,
  runReminderSender,
} from "./sender.ts";

interface HandlerDependencies {
  secret: string;
  store: () => ReminderStore;
  push: () => PushTransport;
  now: () => number;
}

async function sameSecret(actual: string, expected: string): Promise<boolean> {
  const encode = (value: string) =>
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  const [left, right] = await Promise.all([encode(actual), encode(expected)]);
  const a = new Uint8Array(left);
  const b = new Uint8Array(right);
  let difference = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    difference |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return difference === 0;
}

export function createHandler(deps: HandlerDependencies) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }
    const authorization = request.headers.get("authorization") ?? "";
    const token = authorization.startsWith("Bearer ")
      ? authorization.slice(7)
      : "";
    if (!token || !deps.secret || !(await sameSecret(token, deps.secret))) {
      return new Response("Unauthorized", { status: 401 });
    }
    try {
      const result = await runReminderSender(
        deps.store(),
        deps.push(),
        deps.now(),
      );
      return Response.json(result);
    } catch (error) {
      // Never include endpoints, key material, task titles, or provider response bodies in logs.
      console.error(
        "Reminder sender failed",
        error instanceof Error ? error.message : "unknown error",
      );
      return new Response("Reminder sender failed", { status: 500 });
    }
  };
}
