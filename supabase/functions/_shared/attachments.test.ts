import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import {
  ATTACHMENTS_BUCKET,
  listBoardObjectPaths,
  removeBoardAttachments,
  type StorageClient,
} from "./attachments.ts";

type Entry = { name: string; id: string | null };

/**
 * A fake storage surface. Worth having rather than mocking the real client: the properties under
 * test here are the *pagination and recursion*, which a live stack would exercise only with
 * hundreds of objects, and the *ordering contract*, which is about what is called before what.
 */
function fakeStorage(tree: Record<string, Entry[]>) {
  const removed: string[][] = [];
  const listCalls: string[] = [];
  let failRemove: string | null = null;
  let failList: string | null = null;

  const client: StorageClient = {
    storage: {
      from(bucket: string) {
        assertEquals(bucket, ATTACHMENTS_BUCKET);
        return {
          list(path: string, options: { limit: number; offset: number }) {
            listCalls.push(path);
            if (failList === path) {
              return Promise.resolve({ data: null, error: { message: "boom" } });
            }
            const all = tree[path] ?? [];
            return Promise.resolve({
              data: all.slice(options.offset, options.offset + options.limit),
              error: null,
            });
          },
          remove(paths: string[]) {
            if (failRemove !== null) {
              return Promise.resolve({ error: { message: failRemove } });
            }
            removed.push(paths);
            return Promise.resolve({ error: null });
          },
        };
      },
    },
  };

  return {
    client,
    removed,
    listCalls,
    breakRemove: (message: string) => (failRemove = message),
    breakList: (path: string) => (failList = path),
  };
}

const folder = (name: string): Entry => ({ name, id: null });
const file = (name: string): Entry => ({ name, id: crypto.randomUUID() });

Deno.test("collects every file two levels down, and nothing else", async () => {
  const board = "b1";
  const { client, listCalls } = fakeStorage({
    b1: [folder("t1"), folder("t2")],
    "b1/t1": [file("a"), file("b")],
    "b1/t2": [file("c")],
  });

  assertEquals(await listBoardObjectPaths(client, board), [
    "b1/t1/a",
    "b1/t1/b",
    "b1/t2/c",
  ]);
  // Exactly two levels: the Board prefix and each Task folder. Never deeper.
  assertEquals(listCalls, ["b1", "b1/t1", "b1/t2"]);
});

Deno.test("a stray file directly under the Board prefix is still collected", async () => {
  // The object policies refuse a one-segment path, so this should not exist -- but if one ever
  // does, leaving it behind would be leaving something permanently undeletable.
  const { client } = fakeStorage({ b1: [file("stray.png"), folder("t1")], "b1/t1": [file("a")] });
  assertEquals(await listBoardObjectPaths(client, "b1"), ["b1/stray.png", "b1/t1/a"]);
});

Deno.test("pagination is followed past the first page", async () => {
  // 250 files in one Task folder: three pages at the 100 default. A loop that stopped at the first
  // page would leave 150 objects stranded, and every one of them undeletable afterwards.
  const many = Array.from({ length: 250 }, (_, i) => file(`f${String(i).padStart(3, "0")}`));
  const { client } = fakeStorage({ b1: [folder("t1")], "b1/t1": many });

  const paths = await listBoardObjectPaths(client, "b1");
  assertEquals(paths.length, 250);
  assertEquals(paths[0], "b1/t1/f000");
  assertEquals(paths[249], "b1/t1/f249");
});

Deno.test("removal batches, and reports the total", async () => {
  const many = Array.from({ length: 250 }, (_, i) => file(`f${i}`));
  const { client, removed } = fakeStorage({ b1: [folder("t1")], "b1/t1": many });

  assertEquals(await removeBoardAttachments(client, ["b1"]), 250);
  assertEquals(removed.map((batch) => batch.length), [100, 100, 50]);
});

Deno.test("sweeps several boards in one call", async () => {
  const { client, removed } = fakeStorage({
    b1: [folder("t1")],
    "b1/t1": [file("a")],
    b2: [folder("t9")],
    "b2/t9": [file("z")],
  });

  assertEquals(await removeBoardAttachments(client, ["b1", "b2"]), 2);
  assertEquals(removed.flat(), ["b1/t1/a", "b2/t9/z"]);
});

Deno.test("a board with no objects is a no-op, not an error", async () => {
  const { client, removed } = fakeStorage({});
  assertEquals(await removeBoardAttachments(client, ["empty"]), 0);
  assertEquals(removed.length, 0);
});

Deno.test("a failed remove throws, so the caller leaves the rows alone", async () => {
  // The whole ordering guarantee rests on this: if the sweep cannot finish, the Board must survive
  // so the operation can be retried. Swallowing the error here would delete the Board anyway and
  // strand the files permanently.
  const { client, breakRemove } = fakeStorage({ b1: [folder("t1")], "b1/t1": [file("a")] });
  breakRemove("storage unavailable");

  await assertRejects(
    () => removeBoardAttachments(client, ["b1"]),
    Error,
    "storage unavailable",
  );
});

Deno.test("a failed list throws rather than reporting an empty board", async () => {
  // The dangerous failure: treating a list error as "no objects" would sweep nothing, report
  // success, and let the caller delete the Board.
  const { client, breakList } = fakeStorage({ b1: [folder("t1")], "b1/t1": [file("a")] });
  breakList("b1/t1");

  await assertRejects(() => removeBoardAttachments(client, ["b1"]), Error, "list b1/t1");
});
