import { DatabaseSync } from "node:sqlite";

import type { JsonValue } from "@msa/chord";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { openNodeSqliteStorage } from "../src/storage/sqlite/node.ts";
import type { DocumentCreate, DocumentId, EntryId, TaskId } from "../src/types.ts";
import { ROOT_CONVERSATION_ID } from "../src/types.ts";
import { awaited } from "./effect-support.ts";
import { removeDir } from "./platform-support.ts";
import {
  pendingTask,
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

function queryPlanDetails(db: DatabaseSync): string[] {
  const plans = [
    db
      .prepare(`EXPLAIN QUERY PLAN SELECT record FROM documents
						WHERE kind = ? AND scope_kind = ? AND owner_id = ? AND family = ? AND key_value = ?
						AND retired_at IS NULL ORDER BY created_at DESC LIMIT 1`)
      .all("kind", "session", 0, 0, ""),
    db
      .prepare(`EXPLAIN QUERY PLAN SELECT record FROM documents
						WHERE kind = ? AND scope_kind = ? AND owner_id = ? AND family = ? AND key_value = ?
						AND created_at <= ? AND (retired_at IS NULL OR retired_at > ?)
						ORDER BY created_at DESC LIMIT 1`)
      .all("kind", "conversation", 1, 0, "", 10, 10),
    db
      .prepare(`EXPLAIN QUERY PLAN SELECT record FROM documents
						WHERE scope_kind = ? AND owner_id = ? AND kind = ? AND id > ? ORDER BY id LIMIT ?`)
      .all("task", 1, "kind", 0, 10),
    db
      .prepare(`EXPLAIN QUERY PLAN SELECT record FROM entries
						WHERE conversation_id = ? AND id <= ? ORDER BY id DESC LIMIT ?`)
      .all(1, 10, 10),
    db
      .prepare(`EXPLAIN QUERY PLAN SELECT record FROM entries
						WHERE conversation_id = ? AND head IS NOT NULL AND id <= ? ORDER BY id DESC LIMIT 1`)
      .all(1, 10),
    db
      .prepare(
        "EXPLAIN QUERY PLAN SELECT record FROM tasks WHERE status = ? AND id > ? ORDER BY id LIMIT ?",
      )
      .all("pending", 0, 10),
    db
      .prepare(`EXPLAIN QUERY PLAN SELECT seq, kind, version, content FROM document_revisions
						WHERE document_id = ? AND kind = 'base' AND seq <= ? ORDER BY seq DESC LIMIT 1`)
      .all(1, 10),
    db
      .prepare(`EXPLAIN QUERY PLAN SELECT seq, kind, version, content FROM document_revisions
						WHERE document_id = ? AND seq > ? AND seq <= ? ORDER BY seq`)
      .all(1, 5, 10),
  ];
  return plans.map((plan) =>
    plan.map((row) => (row as { readonly detail: string }).detail).join("\n"),
  );
}

const rollsSqlRows = Effect.gen(function* () {
  const { storage, path } = yield* createSqliteStorage();
  yield* awaited(createRoot(storage));
  const transientId = yield* awaited(storage.mintId<EntryId>());
  const transientTaskId = yield* awaited(storage.mintId<TaskId<JsonValue>>());
  const circular: { self?: unknown } = {};
  circular.self = circular;
  yield* awaited(
    expect(
      storage.commit(
        [
          { type: "entry", value: entry(transientId, ROOT_CONVERSATION_ID, undefined) },
          {
            type: "task",
            value: {
              ...pendingTask(transientTaskId),
              input: circular as unknown as JsonValue,
            },
          },
        ],
        context,
      ),
    ).rejects.toThrow("circular structure"),
  );
  expect(yield* awaited(storage.entry(transientId, context))).toBeUndefined();
  expect(yield* awaited(storage.task(transientTaskId, context))).toBeUndefined();
  const committedId = yield* awaited(storage.mintId<EntryId>());
  expect(
    yield* awaited(
      storage.commit(
        [{ type: "entry", value: entry(committedId, ROOT_CONVERSATION_ID, undefined) }],
        context,
      ),
    ),
  ).toBe(2);

  const db = new DatabaseSync(path, { readOnly: true });
  try {
    expect(scalar(db, "SELECT count(*) AS value FROM entries")).toBe(1);
    expect(scalar(db, "SELECT next_seq AS value FROM durable_metadata WHERE singleton = 1")).toBe(
      3,
    );
  } finally {
    db.close();
  }
});

describe("Pico SqliteStorage", () => {
  it("rolls SQL rows and sequence allocation back as one transaction", () =>
    Effect.runPromise(rollsSqlRows));
});

const reconstructsRecentAncientStep1 = Effect.gen(function* () {
  const { storage, path } = yield* createSqliteStorage();
  yield* awaited(createRoot(storage));
  const id = yield* awaited(storage.mintId<DocumentId>());
  const record = {
    id,
    kind: "history",
    scope: { kind: "conversation", conversationId: ROOT_CONVERSATION_ID },
    history: "rewindable",
    fork: "asOf",
  } satisfies DocumentCreate;
  const createdAt = yield* awaited(
    storage.commit(
      [
        {
          type: "document.create",
          record,
          content: { kind: "base", version: 1, value: { count: 0 } },
        },
      ],
      context,
    ),
  );
  return { storage, path, id, createdAt };
});

const reconstructsRecentAncient = Effect.gen(function* () {
  const { storage, path, id, createdAt } = yield* reconstructsRecentAncientStep1;
  let ancientAt = createdAt;
  let recentAt = createdAt;
  for (const count of Array.from({ length: 40 }, (_, i) => 1 + i)) {
    recentAt = yield* awaited(
      storage.commit(
        [
          {
            type: "document.change",
            id,
            content:
              count === 20
                ? { kind: "base", version: 1, value: { count } }
                : { kind: "delta", version: 1, ops: [["s", ["count"], count]] },
          },
        ],
        context,
      ),
    );
    if (count === 5) ancientAt = recentAt;
  }
  yield* awaited(storage.close(context));
  openStorages.delete(storage);
  const reopened = yield* awaited(openNodeSqliteStorage(path));
  openStorages.add(reopened);
  expect((yield* awaited(reopened.document(id, ancientAt, context)))?.value).toEqual({
    count: 5,
  });
  expect((yield* awaited(reopened.document(id, recentAt, context)))?.value).toEqual({
    count: 40,
  });
});

describe("Pico SqliteStorage", () => {
  it("reconstructs recent and ancient rewindable points after reopen", () =>
    Effect.runPromise(reconstructsRecentAncient));
});

const usesIndexesExact = Effect.gen(function* () {
  const { storage, path } = yield* createSqliteStorage();
  yield* awaited(storage.close(context));
  openStorages.delete(storage);
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const details = queryPlanDetails(db);
    expect(details[0]).toContain("documents_by_address");
    expect(details[1]).toContain("documents_by_address");
    expect(details[2]).toContain("documents_by_scope_kind");
    expect(details[3]).toContain("entries_by_conversation");
    expect(details[4]).toContain("entry_heads_by_conversation");
    expect(details[5]).toContain("tasks_by_status");
    expect(details[6]).toContain("document_revisions_by_kind");
    expect(details[7]).toContain("sqlite_autoindex_document_revisions_1");
    for (const detail of details.slice(0, 3)) expect(detail).not.toContain("SCAN documents");
    expect(details[7]).not.toContain("SCAN document_revisions");
  } finally {
    db.close();
  }
});

describe("Pico SqliteStorage", () => {
  it("uses indexes for exact addresses, exact scopes, entry history, and document revision tails", () =>
    Effect.runPromise(usesIndexesExact));
});
