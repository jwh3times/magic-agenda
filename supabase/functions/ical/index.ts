import { createClient } from "npm:@supabase/supabase-js@2.116.0";
import type { Database } from "../../../src/types/database.types.ts";
import { createHandler, type Feed } from "./handler.ts";

// The service-role key is needed only because `ical_feed` is granted to `service_role` alone, so
// that a token is never a Data API credential by itself. The client holds no table grant on the
// Board tables; the definer is its whole reach.
const admin = createClient<Database>(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const handler = createHandler({
  loadFeed: async (token) => {
    const { data, error } = await admin.rpc("ical_feed", { p_token: token });
    if (error) throw error;
    return (data as Feed | null) ?? null;
  },
  now: () => new Date(),
});

Deno.serve(handler);
