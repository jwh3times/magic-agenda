import { createHandler } from "./handler.ts";
import { productionPush } from "./push.ts";
import { productionStore } from "./store.ts";

const handler = createHandler({
  secret: Deno.env.get("REMINDER_CRON_SECRET") ?? "",
  store: productionStore,
  push: productionPush,
  now: Date.now,
});

Deno.serve(handler);
