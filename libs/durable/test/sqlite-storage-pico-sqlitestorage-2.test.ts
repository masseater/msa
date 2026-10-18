import { DatabaseSync } from "node:sqlite";

import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import type { DocumentId, EntryId } from "../src/types.ts";
import { ROOT_CONVERSATION_ID } from "../src/types.ts";
import { awaited } from "./effect-support.ts";
import { fileSize, removeDir } from "./platform-support.ts";
import {
  entry,
  createRoot,
  context,
  tempDirectories,
  openStorages,
  createSqliteStorage,
  scalar,
} from "./sqlite-storage-support.ts";

afterEach(() =>
  Effect.runPromise(
    Effect.gen(function* () {
      for (const storage of openStorages) yield* awaited(storage.close(context));
      openStorages.clear();
      for (const directory of tempDirectories) yield* removeDir(directory);
      tempDirectories.clear();
    }),
  ),
);

const largeReplacedDocument = Effect.fn("largeReplacedDocument")(function* () {
  const { storage, path } = yield* createSqliteStorage();
  yield* awaited(createRoot(storage));
  const id = yield* awaited(storage.mintId<DocumentId>());
  const large = "x".repeat(512 * 1024);
  yield* awaited(
    storage.commit(
      [
        {
          type: "document.create",
          record: { id, kind: "reuse", scope: { kind: "session" } },
          content: { kind: "base", version: 1, value: { text: large } },
        },
      ],
      context,
    ),
  );
  yield* awaited(
    storage.commit(
      [
        {
          type: "document.change",
          id,
          content: { kind: "base", version: 1, value: { text: "small" } },
        },
      ],
      context,
    ),
  );
  return { storage, path, id, large };
});

const representativeRows = Effect.fn("representativeRows")(function* () {
  const { storage, path } = yield* createSqliteStorage();
  yield* awaited(createRoot(storage));
  for (const index of Array.from({ length: 100 }, (_, i) => i)) {
    yield* awaited(
      storage.commit(
        [
          {
            type: "entry",
            value: entry(yield* awaited(storage.mintId<EntryId>()), ROOT_CONVERSATION_ID, {
              index,
              text: "x".repeat(1_024),
            }),
          },
        ],
        context,
      ),
    );
  }
  return { storage, path };
});

const autoCheckpointsWal = Effect.gen(function* () {
  const { storage, path } = yield* createSqliteStorage({ walAutoCheckpointPages: 1 });
  yield* awaited(createRoot(storage));
  for (const index of Array.from({ length: 20 }, (_, i) => i)) {
    yield* awaited(
      storage.commit(
        [
          {
            type: "entry",
            value: entry(yield* awaited(storage.mintId<EntryId>()), ROOT_CONVERSATION_ID, {
              text: "x".repeat(32 * 1024),
              index,
            }),
          },
        ],
        context,
      ),
    );
  }
  const walPath = `${path}-wal`;
  expect(yield* fileSize(walPath)).toBeLessThan(512 * 1024);
  const observer = new DatabaseSync(path, { readOnly: true });
  yield* Effect.gen(function* () {
    expect(scalar(observer, "SELECT count(*) AS value FROM entries")).toBe(20);
    yield* awaited(storage.close(context));
    openStorages.delete(storage);
    expect(yield* fileSize(walPath)).toBe(0);
  }).pipe(
    Effect.ensuring(
      Effect.sync(() => {
        observer.close();
      }),
    ),
  );
});

describe("Pico SqliteStorage", () => {
  it("auto-checkpoints WAL frames and truncates the WAL on close", () =>
    Effect.runPromise(autoCheckpointsWal));
});

const reusesPagesReleased = Effect.gen(function* () {
  const { storage, path, id, large } = yield* largeReplacedDocument();
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
  yield* awaited(
    storage.commit(
      [
        {
          type: "document.change",
          id,
          content: { kind: "base", version: 1, value: { text: large } },
        },
      ],
      context,
    ),
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

describe("Pico SqliteStorage", () => {
  it("reuses pages released by current-only checkpoints", () =>
    Effect.runPromise(reusesPagesReleased));
});

const keepsRepresentativeRow = Effect.gen(function* () {
  const { storage, path } = yield* representativeRows();
  const documentId = yield* awaited(storage.mintId<DocumentId>());
  yield* awaited(
    storage.commit(
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
    ),
  );
  for (const count of Array.from({ length: 100 }, (_, i) => 1 + i)) {
    yield* awaited(
      storage.commit(
        [
          {
            type: "document.change",
            id: documentId,
            content: { kind: "delta", version: 1, ops: [["s", ["count"], count]] },
          },
        ],
        context,
      ),
    );
  }
  yield* awaited(storage.close(context));
  openStorages.delete(storage);
  expect(yield* fileSize(path)).toBeLessThan(1024 * 1024);
});

describe("Pico SqliteStorage", () => {
  it("keeps representative row and document storage bounded", () =>
    Effect.runPromise(keepsRepresentativeRow));
});
