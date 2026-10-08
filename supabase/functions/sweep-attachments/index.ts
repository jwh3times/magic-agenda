import { createHandler } from "./handler.ts";
import { productionStore } from "./store.ts";

// The cron bearer secret is shared with `send-reminders` and `materialize-series`: all three are
// invoked by `pg_cron` with the same Vault entry. See the schedule in
// `20261008140000_attachment_orphan_sweep.sql`.
const handler = createHandler({
  secret: Deno.env.get("REMINDER_CRON_SECRET") ?? "",
  store: productionStore,
});

Deno.serve(handler);
