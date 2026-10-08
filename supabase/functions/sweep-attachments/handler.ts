import { bearerToken, sameSecret } from "../_shared/bearer.ts";

export interface SweepStore {
  /** Paths that have had no `task_attachments` row since an earlier run, oldest first. */
  collect: (graceSeconds: number, limit: number) => Promise<string[]>;
  remove: (paths: string[]) => Promise<void>;
}

interface HandlerDependencies {
  secret: string;
  /** Built only after the bearer check passes: it holds the service-role client. */
  store: () => SweepStore;
  graceSeconds?: number;
  limit?: number;
  batchSize?: number;
}

/**
 * How long an object must have been row-less before it is removed. Undo is offered for seconds,
 * and the command already withholds anything it first saw on this run, so an hour is margin
 * rather than the mechanism.
 */
const DEFAULT_GRACE_SECONDS = 3600;
/** Per run. A backlog larger than this drains over the following days. */
const DEFAULT_LIMIT = 1000;
/** Storage `remove()` takes a list; keep each request bounded. */
const DEFAULT_BATCH_SIZE = 100;

/**
 * The daily attachment sweep, invoked by `pg_cron` with the cron bearer secret.
 *
 * Deleting a Task leaves its files in storage for Undo, where no API role can read or remove
 * them. `collect_attachment_orphans` names the ones that are safe to delete; this removes them.
 *
 * **Batches fail independently**, and a failure costs nothing: the object keeps its mark, so the
 * next run offers it again. The run then answers 500 so the failure shows in the function logs
 * and `net._http_response`. Counts only -- paths are Board and Task ids.
 */
export function createHandler(deps: HandlerDependencies) {
  const graceSeconds = deps.graceSeconds ?? DEFAULT_GRACE_SECONDS;
  const limit = deps.limit ?? DEFAULT_LIMIT;
  const batchSize = deps.batchSize ?? DEFAULT_BATCH_SIZE;
  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }
    const token = bearerToken(request);
    if (!token || !(await sameSecret(token, deps.secret))) {
      return new Response("Unauthorized", { status: 401 });
    }

    const store = deps.store();

    let paths: string[];
    try {
      paths = await store.collect(graceSeconds, limit);
    } catch (cause) {
      console.error("sweep-attachments: collect failed", cause);
      return Response.json({ error: "collect failed" }, { status: 500 });
    }

    let removed = 0;
    let failedBatches = 0;
    for (let i = 0; i < paths.length; i += batchSize) {
      const batch = paths.slice(i, i + batchSize);
      try {
        await store.remove(batch);
        removed += batch.length;
      } catch (cause) {
        failedBatches++;
        console.error("sweep-attachments: batch removal failed", cause);
      }
    }

    return Response.json(
      { offered: paths.length, removed, failedBatches },
      { status: failedBatches === 0 ? 200 : 500 },
    );
  };
}
