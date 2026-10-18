import { DatabaseSync } from "node:sqlite";

import type { DocumentId } from "@msa/durable";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { createRoot, createSqliteStorage } from "./sqlite-storage-support.ts";
import { awaited, context } from "./support.ts";

const replacedDocumentStep1 = Effect.fn("replacedDocumentStep1")(function* () {
  const { storage, path } = yield* createSqliteStorage();
  yield* awaited(createRoot(storage));
  const id = yield* awaited(storage.mintId<DocumentId>());
  yield* awaited(
    storage.commit(
      [
        {
          type: "document.create",
          record: { id, kind: "replay", scope: { kind: "session" } },
          content: { kind: "base", version: 1, value: { nested: { value: 1 }, rows: [] } },
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
          content: {
            kind: "delta",
            version: 1,
            ops: [["r", { nested: { value: 2 }, rows: [{ id: 1 }] }]],
          },
        },
      ],
      context,
    ),
  );
  return { storage, path, id };
});

const replacedDocument = Effect.fn("replacedDocument")(function* () {
  const { storage, path, id } = yield* replacedDocumentStep1();
  yield* awaited(
    storage.commit(
      [
        {
          type: "document.change",
          id,
          content: {
            kind: "delta",
            version: 1,
            ops: [
              ["s", ["nested", "value"], 3],
              ["p", ["rows"], 1, 0, [{ id: 2 }]],
              ["m", ["rows"], [1, 0]],
            ],
          },
        },
      ],
      context,
    ),
  );
  return { storage, path, id };
});

const rejectsDocumentRequired = Effect.gen(function* () {
  const { storage, path } = yield* createSqliteStorage();
  yield* awaited(createRoot(storage));
  const id = yield* awaited(storage.mintId<DocumentId>());
  yield* awaited(
    storage.commit(
      [
        {
          type: "document.create",
          record: { id, kind: "corrupt", scope: { kind: "session" } },
          content: { kind: "base", version: 1, value: { retained: true } },
        },
      ],
      context,
    ),
  );
  const database = new DatabaseSync(path);
  try {
    database.prepare("DELETE FROM document_revisions WHERE document_id = ?").run(id);
  } finally {
    database.close();
  }
  yield* awaited(
    expect(storage.document(id, "current", context)).rejects.toThrow(
      `Document ${id} is missing a required base`,
    ),
  );
});

describe("Pico SqliteStorage", () => {
  it("rejects a document whose required base is missing", () =>
    Effect.runPromise(rejectsDocumentRequired));
});

const replaysDetachedRoot = Effect.gen(function* () {
  const { storage, path, id } = yield* replacedDocument();
  yield* awaited(
    storage.commit(
      [
        {
          type: "document.change",
          id,
          content: { kind: "delta", version: 1, ops: [["s", ["nested", "value"], 4]] },
        },
      ],
      context,
    ),
  );

  const expected = { nested: { value: 4 }, rows: [{ id: 2 }, { id: 1 }] };
  const first = (yield* awaited(storage.document(id, "current", context)))!;
  expect(first.value).toEqual(expected);
  (first.value["nested"] as { value: number }).value = 99;
  (first.value["rows"] as Array<{ id: number }>)[0]!.id = 99;
  expect((yield* awaited(storage.document(id, "current", context)))?.value).toEqual(expected);

  const database = new DatabaseSync(path);
  try {
    database
      .prepare(`UPDATE document_revisions SET content = ? WHERE document_id = ? AND seq =
					(SELECT max(seq) FROM document_revisions WHERE document_id = ?)`)
      .run('[["unknown"]]', id, id);
  } finally {
    database.close();
  }
  yield* awaited(
    expect(storage.document(id, "current", context)).rejects.toThrow("unknown op verb"),
  );
});

describe("Pico SqliteStorage", () => {
  it("replays detached root replacements and follow-up edits while rejecting corrupt operations", () =>
    Effect.runPromise(replaysDetachedRoot));
});
