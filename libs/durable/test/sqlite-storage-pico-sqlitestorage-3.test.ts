import { DatabaseSync } from "node:sqlite";

import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import type { DocumentId } from "../src/types.ts";
import { fromJsonText, awaited } from "./effect-support.ts";
import { removeDir } from "./platform-support.ts";
import {
  createRoot,
  context,
  tempDirectories,
  openStorages,
  createSqliteStorage,
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
          type: "document.create",
          record: { id, kind: "latest", scope: { kind: "session" } },
          content: { kind: "base", version: 1, value: { count: 0 } },
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
            type: "document.change",
            id,
            content: { kind: "delta", version: 1, ops: [["s", ["count"], count]] },
          },
        ],
        context,
      ),
    );
  }
  return { storage, path, id };
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
          type: "document.change",
          id,
          content: { kind: "base", version: 1, value: { count: 11 } },
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
          type: "document.change",
          id,
          content: { kind: "delta", version: 1, ops: [["r", { count: 12 }]] },
        },
      ],
      context,
    ),
  );
  expect(revisionCount(path, id)).toBe(2);
  yield* awaited(storage.commit([{ type: "document.retire", id }], context));
  expect(revisionCount(path, id)).toBe(0);
});

describe("Pico SqliteStorage", () => {
  it("reclaims current-only revisions only after a base or retirement", () =>
    Effect.runPromise(reclaimsCurrentOnly));
});
