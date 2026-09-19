export const ATTACHMENTS_BUCKET = "attachments";

/**
 * Only what this module actually uses, rather than `SupabaseClient`.
 *
 * Two reasons, and the second is why it is not just tidiness: the handlers build their clients with
 * an untyped `createClient`, whose generic defaults do not match `SupabaseClient`'s, so naming the
 * class makes the call sites fail to type-check. Describing the surface structurally accepts any
 * client that has it -- and makes this module trivially fake-able in a test without a network.
 */
export type StorageClient = {
  storage: {
    from(bucket: string): {
      list(
        path: string,
        options: { limit: number; offset: number },
      ): Promise<{
        data: { name: string; id: string | null }[] | null;
        error: { message: string } | null;
      }>;
      remove(paths: string[]): Promise<{ error: { message: string } | null }>;
    };
  };
};

/** Storage `remove()` takes a list; keep each request bounded rather than sending thousands. */
const REMOVE_BATCH = 100;

/** `list()` pages. 100 is the API default; naming it makes the loop's exit condition obvious. */
const LIST_PAGE = 100;

/**
 * Every object path under one Board's prefix.
 *
 * **Enumerated from storage, never from `task_attachments`.** An object can exist with no row at
 * all (#400) -- the object policies authorize by Board prefix and do not require a row -- so
 * listing rows would silently leave those files behind, which is the bug this whole exercise is
 * about, in a subtler form.
 *
 * Paths are exactly `<board_id>/<task_id>/<attachment_id>`, which the object policies now enforce
 * by requiring two folder segments. So this recurses exactly two levels and no further: Board
 * prefix -> Task folders -> files. A folder entry is one whose `id` is null.
 */
export async function listBoardObjectPaths(
  admin: StorageClient,
  boardId: string,
): Promise<string[]> {
  const paths: string[] = [];

  for (const taskFolder of await listPage(admin, boardId)) {
    // Files directly under the Board prefix should not exist -- the policies refuse a one-segment
    // path -- but collect them if present rather than leaving something undeletable behind.
    if (taskFolder.id !== null) {
      paths.push(`${boardId}/${taskFolder.name}`);
      continue;
    }
    for (const file of await listPage(admin, `${boardId}/${taskFolder.name}`)) {
      if (file.id !== null) paths.push(`${boardId}/${taskFolder.name}/${file.name}`);
    }
  }

  return paths;
}

async function listPage(
  admin: StorageClient,
  prefix: string,
): Promise<{ name: string; id: string | null }[]> {
  const all: { name: string; id: string | null }[] = [];
  for (let offset = 0; ; offset += LIST_PAGE) {
    const { data, error } = await admin.storage
      .from(ATTACHMENTS_BUCKET)
      .list(prefix, { limit: LIST_PAGE, offset });
    if (error) throw new Error(`list ${prefix}: ${error.message}`);
    if (!data || data.length === 0) return all;
    all.push(...data);
    if (data.length < LIST_PAGE) return all;
  }
}

/**
 * Delete every attachment object belonging to these Boards.
 *
 * **Call this BEFORE deleting the Board rows, always.** `attachments_delete_editor` authorizes by
 * matching the path's first segment against `board_memberships`; once the Board is gone there is no
 * membership to match, so no caller can ever authorize the delete. Service-role bypasses RLS and so
 * could clean up afterwards in principle -- but the Board id would have to be remembered somewhere
 * that the cascade has not already destroyed, and nothing records it. Ordering is the whole fix.
 *
 * Throws on failure, deliberately. The caller must then leave the Board rows alone so the operation
 * can be retried: a Board that still exists with some of its files gone is recoverable, while a
 * deleted Board with files left behind is not. `remove()` on an already-absent path is not an
 * error, so a retry is safe.
 */
export async function removeBoardAttachments(
  admin: StorageClient,
  boardIds: string[],
): Promise<number> {
  let removed = 0;

  for (const boardId of boardIds) {
    const paths = await listBoardObjectPaths(admin, boardId);
    for (let i = 0; i < paths.length; i += REMOVE_BATCH) {
      const batch = paths.slice(i, i + REMOVE_BATCH);
      const { error } = await admin.storage.from(ATTACHMENTS_BUCKET).remove(batch);
      if (error) throw new Error(`remove ${batch.length} object(s): ${error.message}`);
      removed += batch.length;
    }
  }

  return removed;
}
