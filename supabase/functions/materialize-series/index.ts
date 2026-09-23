import { createHandler } from "./handler.ts";
import { productionStore } from "./store.ts";

// The cron bearer secret is shared with `send-reminders`: both are invoked by `pg_cron` with the
// same Vault entry. See the schedule in `20260923120000_series_materialization.sql`.
const handler = createHandler({
  secret: Deno.env.get("REMINDER_CRON_SECRET") ?? "",
  store: productionStore,
  now: () => new Date(),
  nextId: () => crypto.randomUUID(),
});

Deno.serve(handler);
