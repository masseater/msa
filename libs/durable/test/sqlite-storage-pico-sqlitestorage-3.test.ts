import { DatabaseSync } from "node:sqlite";

import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import type { DocumentId } from "../src/types.ts";
import effectSupport from "./effect-support.ts";
import platformSupport from "./platform-support.ts";
import sqliteStorageSupport from "./sqlite-storage-support.ts";

const { awaited, fromJsonText } = effectSupport;
const { removeDir } = platformSupport;
const { context, createRoot, createSqliteStorage, openStorages, tempDirectories } =
  sqliteStorageSupport;

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

function revisionCount(path: string, documentId: DocumentId): number {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const row = db
      .prepare("SELECT count(*) AS count FROM document_revisions WHERE document_id = ?")
      .get(documentId) as { readonly count: number };
    return row.count;
  } finally {
    db.close();
  }
}

const checkpointedRevisions = Effect.fn("checkpointedRevisions")(function* () {
  const { storage, path } = yield* createSqliteStorage();
  yield* awaited(createRoot(storage));
  const id = yield* awaited(storage.mintId<DocumentId>());
  yield* awaited(
    storage.commit(
      [
        {
          content: { kind: "base", value: { count: 0 }, version: 1 },
          record: { id, kind: "latest", scope: { kind: "session" } },
          type: "document.create",
        },
      ],
      context,
    ),
  );
  for (const count of Array.from({ length: 10 }, (_, i) => 1 + i)) {
    yield* awaited(
      storage.commit(
        [
          {
            content: { kind: "delta", ops: [["s", ["count"], count]], version: 1 },
            id,
            type: "document.change",
          },
        ],
        context,
      ),
    );
  }
  return { id, path, storage };
});

const reclaimsCurrentOnly = Effect.gen(function* () {
  const { storage, path, id } = yield* checkpointedRevisions();
  expect(revisionCount(path, id)).toBe(11);
  const revisions = new DatabaseSync(path, { readOnly: true });
  try {
    const row = revisions
      .prepare(
        "SELECT content FROM document_revisions WHERE document_id = ? AND kind = 'delta' ORDER BY seq DESC LIMIT 1",
      )
      .get(id) as { readonly content: string };
    expect(yield* fromJsonText(row.content)).toEqual([["s", ["count"], 10]]);
  } finally {
    revisions.close();
  }
  yield* awaited(
    storage.commit(
      [
        {
          content: { kind: "base", value: { count: 11 }, version: 1 },
          id,
          type: "document.change",
        },
      ],
      context,
    ),
  );
  expect(revisionCount(path, id)).toBe(1);
  yield* awaited(
    storage.commit(
      [
        {
          content: { kind: "delta", ops: [["r", { count: 12 }]], version: 1 },
          id,
          type: "document.change",
        },
      ],
      context,
    ),
  );
  expect(revisionCount(path, id)).toBe(2);
  yield* awaited(storage.commit([{ id, type: "document.retire" }], context));
  expect(revisionCount(path, id)).toBe(0);
});

describe("Pico SqliteStorage", () => {
  it("reclaims current-only revisions only after a base or retirement", () =>
    Effect.runPromise(reclaimsCurrentOnly));
});
