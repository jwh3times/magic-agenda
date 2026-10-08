import { createClient } from "npm:@supabase/supabase-js@2.116.0";
import type { Database } from "../../../src/types/database.types.ts";
import { ATTACHMENTS_BUCKET } from "../_shared/attachments.ts";
import type { SweepStore } from "./handler.ts";

/**
 * The service-role reach of the sweep: one command that names row-less objects, and Storage
 * `remove()` on exactly the paths it returned. See `20261008140000_attachment_orphan_sweep.sql`.
 */
export function productionStore(): SweepStore {
  const client = createClient<Database>(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  return {
    collect: async (graceSeconds, limit) => {
      const { data, error } = await client.rpc("collect_attachment_orphans", {
        p_grace_seconds: graceSeconds,
        p_limit: limit,
      });
      if (error) throw error;
      return data ?? [];
    },
    remove: async (paths) => {
      const { error } = await client.storage.from(ATTACHMENTS_BUCKET).remove(
        paths,
      );
      if (error) throw error;
    },
  };
}
