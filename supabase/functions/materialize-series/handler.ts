import { bearerToken, sameSecret } from "../_shared/bearer.ts";
import {
  type MaterializationState,
  materializationWindow,
  planMaterialization,
  type TaskInsert,
} from "./plan.ts";

export interface MaterializationStore {
  load: (from: string) => Promise<MaterializationState>;
  /** Inserts one chunk and resolves to how many rows it actually wrote. */
  insert: (rows: TaskInsert[]) => Promise<number>;
}

interface HandlerDependencies {
  secret: string;
  /** Built only after the bearer check passes: it holds the service-role client. */
  store: () => MaterializationStore;
  now: () => Date;
  nextId: () => string;
  chunkSize?: number;
}

const DEFAULT_CHUNK_SIZE = 500;

/**
 * The daily Series materialization run (#424), invoked by `pg_cron` with the cron bearer secret.
 *
 * It reads every definition plus the Occurrences already in the window, plans with the client's
 * own planner (`plan.ts`), and inserts in chunks through a command that skips anything that already
 * exists. So it can run while a client is materializing the same Board, and running it twice is a
 * no-op.
 *
 * **Chunks fail independently.** A definition deleted mid-run can fail its chunk on the foreign
 * key; every other Board's Occurrences should still land. The run then answers 500 so the failure
 * shows in the function logs and `net._http_response`, and the next day's run fills the gap.
 */
export function createHandler(deps: HandlerDependencies) {
  const chunkSize = deps.chunkSize ?? DEFAULT_CHUNK_SIZE;
  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }
    const token = bearerToken(request);
    if (!token || !(await sameSecret(token, deps.secret))) {
      return new Response("Unauthorized", { status: 401 });
    }

    const store = deps.store();
    const { todayStr, from } = materializationWindow(deps.now());

    let state: MaterializationState;
    try {
      state = await store.load(from);
    } catch (cause) {
      console.error("materialize-series: state read failed", cause);
      return Response.json({ error: "state read failed" }, { status: 500 });
    }

    const rows = planMaterialization(state, todayStr, deps.nextId);
    let inserted = 0;
    let failedChunks = 0;
    for (let i = 0; i < rows.length; i += chunkSize) {
      try {
        inserted += await store.insert(rows.slice(i, i + chunkSize));
      } catch (cause) {
        failedChunks++;
        console.error("materialize-series: chunk insert failed", cause);
      }
    }

    return Response.json(
      {
        definitions: state.definitions.length,
        proposed: rows.length,
        inserted,
        failedChunks,
      },
      { status: failedChunks === 0 ? 200 : 500 },
    );
  };
}
