import {
  type PushTransport,
  type ReminderStore,
  runReminderSender,
} from "./sender.ts";
import { bearerToken, sameSecret } from "../_shared/bearer.ts";

interface HandlerDependencies {
  secret: string;
  store: () => ReminderStore;
  push: () => PushTransport;
  now: () => number;
}

export function createHandler(deps: HandlerDependencies) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }
    const token = bearerToken(request);
    if (!token || !(await sameSecret(token, deps.secret))) {
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
