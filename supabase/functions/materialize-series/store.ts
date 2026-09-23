import { createClient } from "npm:@supabase/supabase-js@2.116.0";
import type { Database, Json } from "../../../src/types/database.types.ts";
import type { MaterializationStore } from "./handler.ts";
import type { MaterializationState } from "./plan.ts";

/**
 * The service-role reach of the materializer: the two #424 commands and nothing else. Both are
 * `security invoker` functions granted only to `service_role`; see
 * `20260923120000_series_materialization.sql`.
 */
export function productionStore(): MaterializationStore {
  const client = createClient<Database>(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  return {
    load: async (from) => {
      const { data, error } = await client.rpc("series_materialization_state", {
        p_from: from,
      });
      if (error) throw error;
      return data as unknown as MaterializationState;
    },
    insert: async (rows) => {
      const { data, error } = await client.rpc(
        "insert_materialized_occurrences",
        { p_rows: rows as unknown as Json },
      );
      if (error) throw error;
      return data;
    },
  };
}
