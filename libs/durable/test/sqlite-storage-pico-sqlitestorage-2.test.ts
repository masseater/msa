import { rm, stat } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vite-plus/test";

import type { DocumentId, EntryId } from "../src/types.ts";
import { ROOT_CONVERSATION_ID } from "../src/types.ts";
import {
  entry,
  createRoot,
  context,
  tempDirectories,
  openStorages,
  createSqliteStorage,
  scalar,
} from "./sqlite-storage-support.ts";

afterEach(async () => {
  for await (const storage of openStorages) await storage.close(context);
  openStorages.clear();
  for await (const directory of tempDirectories)
    await rm(directory, { recursive: true, force: true });
  tempDirectories.clear();
});

async function largeReplacedDocument() {
  const { storage, path } = await createSqliteStorage();
  await createRoot(storage);
  const id = await storage.mintId<DocumentId>();
  const large = "x".repeat(512 * 1024);
  await storage.commit(
    [
      {
        type: "document.create",
        record: { id, kind: "reuse", scope: { kind: "session" } },
        content: { kind: "base", version: 1, value: { text: large } },
      },
    ],
    context,
  );
  await storage.commit(
    [
      {
        type: "document.change",
        id,
        content: { kind: "base", version: 1, value: { text: "small" } },
      },
    ],
    context,
  );
  return { storage, path, id, large };
}

async function representativeRows() {
  const { storage, path } = await createSqliteStorage();
  await createRoot(storage);
  for await (const index of Array.from({ length: 100 }, (_, i) => i)) {
    await storage.commit(
      [
        {
          type: "entry",
          value: entry(await storage.mintId<EntryId>(), ROOT_CONVERSATION_ID, {
            index,
            text: "x".repeat(1_024),
          }),
        },
      ],
      context,
    );
  }
  return { storage, path };
}

describe("Pico SqliteStorage", () => {
  it("auto-checkpoints WAL frames and truncates the WAL on close", async () => {
    const { storage, path } = await createSqliteStorage({ walAutoCheckpointPages: 1 });
    await createRoot(storage);
    for await (const index of Array.from({ length: 20 }, (_, i) => i)) {
      await storage.commit(
        [
          {
            type: "entry",
            value: entry(await storage.mintId<EntryId>(), ROOT_CONVERSATION_ID, {
              text: "x".repeat(32 * 1024),
              index,
            }),
          },
        ],
        context,
      );
    }
    const walPath = `${path}-wal`;
    expect((await stat(walPath)).size).toBeLessThan(512 * 1024);
    const observer = new DatabaseSync(path, { readOnly: true });
    try {
      expect(scalar(observer, "SELECT count(*) AS value FROM entries")).toBe(20);
      await storage.close(context);
      openStorages.delete(storage);
      expect((await stat(walPath)).size).toBe(0);
    } finally {
      observer.close();
    }
  });
});

describe("Pico SqliteStorage", () => {
  it("reuses pages released by current-only checkpoints", async () => {
    const { storage, path, id, large } = await largeReplacedDocument();
    const before = new DatabaseSync(path, { readOnly: true });
    let pagesAfterDelete: number;
    let freeAfterDelete: number;
    try {
      pagesAfterDelete = scalar(before, "SELECT page_count AS value FROM pragma_page_count() ");
      freeAfterDelete = scalar(
        before,
        "SELECT freelist_count AS value FROM pragma_freelist_count() ",
      );
    } finally {
      before.close();
    }
    expect(freeAfterDelete).toBeGreaterThan(0);
    await storage.commit(
      [
        {
          type: "document.change",
          id,
          content: { kind: "base", version: 1, value: { text: large } },
        },
      ],
      context,
    );
    const after = new DatabaseSync(path, { readOnly: true });
    try {
      const pagesAfterReuse = scalar(after, "SELECT page_count AS value FROM pragma_page_count() ");
      const freeAfterReuse = scalar(
        after,
        "SELECT freelist_count AS value FROM pragma_freelist_count() ",
      );
      expect(pagesAfterReuse).toBeLessThanOrEqual(pagesAfterDelete + 2);
      expect(freeAfterReuse).toBeLessThan(freeAfterDelete);
    } finally {
      after.close();
    }
  });
});

describe("Pico SqliteStorage", () => {
  it("keeps representative row and document storage bounded", async () => {
    const { storage, path } = await representativeRows();
    const documentId = await storage.mintId<DocumentId>();
    await storage.commit(
      [
        {
          type: "document.create",
          record: {
            id: documentId,
            kind: "size.history",
            scope: { kind: "conversation", conversationId: ROOT_CONVERSATION_ID },
            history: "rewindable",
            fork: "asOf",
          },
          content: { kind: "base", version: 1, value: { count: 0 } },
        },
      ],
      context,
    );
    for await (const count of Array.from({ length: 100 }, (_, i) => 1 + i)) {
      await storage.commit(
        [
          {
            type: "document.change",
            id: documentId,
            content: { kind: "delta", version: 1, ops: [["s", ["count"], count]] },
          },
        ],
        context,
      );
    }
    await storage.close(context);
    openStorages.delete(storage);
    expect((await stat(path)).size).toBeLessThan(1024 * 1024);
  });
});
