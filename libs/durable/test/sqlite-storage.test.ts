import { DatabaseSync } from "node:sqlite";

import type { Context, JsonValue } from "@msa/chord";
import { registerStorageConformance } from "@msa/durable/testing";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { idFromNumber } from "../src/ids.ts";
import type { SqliteStorage } from "../src/storage/sqlite/index.ts";
import {
  type NodeSqliteStorageOptions,
  openNodeSqliteStorage,
} from "../src/storage/sqlite/node.ts";
import type {
  ConversationId,
  DocumentId,
  EntryId,
  Id,
  Seq,
  Storage,
  StorageWrite,
  TaskId,
} from "../src/types.ts";
import { ROOT_CONVERSATION_ID } from "../src/types.ts";
import {
  pendingTask,
  entry,
  createRoot,
  context,
  tempDirectories,
  openStorages,
  createSqliteStorage,
} from "./sqlite-storage-support.ts";
import { makeTempFile, removeDir } from "./temp-support.ts";

afterEach(async () => {
  for await (const storage of openStorages) await storage.close(context);
  openStorages.clear();
  for await (const directory of tempDirectories) await removeDir(directory);
  tempDirectories.clear();
});

class ReopeningStorage implements Storage {
  private current: SqliteStorage;
  private readonly path: string;
  private readonly options: NodeSqliteStorageOptions;
  private closed = false;

  constructor(current: SqliteStorage, path: string, options: NodeSqliteStorageOptions = {}) {
    this.current = current;
    this.path = path;
    this.options = options;
  }

  async commit(
    writes: readonly StorageWrite[],
    commitContext: Parameters<Storage["commit"]>[1],
  ): Promise<Seq> {
    if (this.closed) return this.current.commit(writes, commitContext);
    try {
      return await this.current.commit(writes, commitContext);
    } finally {
      await this.current.close(context);
      this.current = await openNodeSqliteStorage(this.path, this.options);
    }
  }

  mintId<I extends Id<string>>(): Promise<I> {
    return this.current.mintId<I>();
  }
  conversation: Storage["conversation"] = (id, readContext) =>
    this.current.conversation(id, readContext);
  scanConversations: Storage["scanConversations"] = (query, limit, cursor, readContext) =>
    this.current.scanConversations(query, limit, cursor, readContext);
  entry(id: EntryId, readContext: Context): ReturnType<Storage["entry"]>;
  entry(
    conversationId: ConversationId,
    id: EntryId,
    readContext: Context,
  ): ReturnType<Storage["entry"]>;
  entry(
    idOrConversationId: EntryId | ConversationId,
    idOrContext: EntryId | Context,
    readContext?: Context,
  ) {
    if (readContext === undefined) {
      return this.current.entry(idFromNumber<EntryId>(idOrConversationId), idOrContext as Context);
    }
    if (typeof idOrContext !== "number")
      throw new TypeError("Storage.entry() requires an entry ID");
    return this.current.entry(
      idFromNumber<ConversationId>(idOrConversationId),
      idFromNumber<EntryId>(idOrContext),
      readContext,
    );
  }
  findLatestHeadMarker: Storage["findLatestHeadMarker"] = (conversationId, at, readContext) =>
    this.current.findLatestHeadMarker(conversationId, at, readContext);
  scanEntries: Storage["scanEntries"] = (query, limit, cursor, readContext) =>
    this.current.scanEntries(query, limit, cursor, readContext);
  task: Storage["task"] = (id, readContext) => this.current.task(id, readContext);
  scanTasks: Storage["scanTasks"] = (query, limit, cursor, readContext) =>
    this.current.scanTasks(query, limit, cursor, readContext);
  submission: Storage["submission"] = (id, readContext) => this.current.submission(id, readContext);
  scanSubmissions: Storage["scanSubmissions"] = (query, limit, cursor, readContext) =>
    this.current.scanSubmissions(query, limit, cursor, readContext);
  submissionByRequest: Storage["submissionByRequest"] = (conversationId, requestId, readContext) =>
    this.current.submissionByRequest(conversationId, requestId, readContext);
  findDocument: Storage["findDocument"] = (address, at, readContext) =>
    this.current.findDocument(address, at, readContext);
  document: Storage["document"] = (id, at, readContext) =>
    this.current.document(id, at, readContext);
  scanDocuments: Storage["scanDocuments"] = (query, limit, cursor, readContext) =>
    this.current.scanDocuments(query, limit, cursor, readContext);

  async close(closeContext: Parameters<Storage["close"]>[0]): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.current.close(closeContext);
  }
}

registerStorageConformance({ describe, expect, it }, "SqliteStorage", async (use) =>
  use((await createSqliteStorage()).storage),
);

registerStorageConformance({ describe, expect, it }, "SqliteStorage across reopen", async (use) => {
  const { directory, path } = await makeTempFile(
    "msa-durable-sqlite-conformance-",
    "storage.sqlite",
  );
  const created = await openNodeSqliteStorage(path);
  await created.close(context);
  const storage = new ReopeningStorage(await openNodeSqliteStorage(path), path);
  try {
    await use(storage);
  } finally {
    await storage.close(context);
    await removeDir(directory);
  }
});

async function replacedDocument() {
  const { storage, path } = await createSqliteStorage();
  await createRoot(storage);
  const id = await storage.mintId<DocumentId>();
  await storage.commit(
    [
      {
        type: "document.create",
        record: { id, kind: "replay", scope: { kind: "session" } },
        content: { kind: "base", version: 1, value: { nested: { value: 1 }, rows: [] } },
      },
    ],
    context,
  );
  await storage.commit(
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
  );
  await storage.commit(
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
  );
  return { storage, path, id };
}

describe("Pico SqliteStorage", () => {
  it("persists records, sequence allocation, and global ID allocation across reopen", async () => {
    const { storage, path } = await createSqliteStorage();
    expect(await createRoot(storage)).toBe(1);
    const entryId = await storage.mintId<EntryId>();
    expect(
      await storage.commit(
        [{ type: "entry", value: entry(entryId, ROOT_CONVERSATION_ID) }],
        context,
      ),
    ).toBe(2);
    await storage.close(context);
    openStorages.delete(storage);

    const reopened = await openNodeSqliteStorage(path);
    openStorages.add(reopened);
    expect(await reopened.entry(entryId, context)).toEqual({
      entry: entry(entryId, ROOT_CONVERSATION_ID),
      commitSeq: 2,
    });
    expect(await reopened.mintId<EntryId>()).toBe(entryId + 1);
    expect(
      await reopened.commit(
        [{ type: "task", value: pendingTask(await reopened.mintId<TaskId<JsonValue>>()) }],
        context,
      ),
    ).toBe(3);
  });

  it("rejects persisted metadata corruption on reopen", async () => {
    const { storage, path } = await createSqliteStorage();
    await storage.close(context);
    openStorages.delete(storage);
    const database = new DatabaseSync(path);
    try {
      database.exec("DELETE FROM durable_metadata");
    } finally {
      database.close();
    }
    await expect(openNodeSqliteStorage(path)).rejects.toThrow("Durable SQLite metadata is missing");
  });
});

describe("Pico SqliteStorage", () => {
  it("rejects a document whose required base is missing", async () => {
    const { storage, path } = await createSqliteStorage();
    await createRoot(storage);
    const id = await storage.mintId<DocumentId>();
    await storage.commit(
      [
        {
          type: "document.create",
          record: { id, kind: "corrupt", scope: { kind: "session" } },
          content: { kind: "base", version: 1, value: { retained: true } },
        },
      ],
      context,
    );
    const database = new DatabaseSync(path);
    try {
      database.prepare("DELETE FROM document_revisions WHERE document_id = ?").run(id);
    } finally {
      database.close();
    }
    await expect(storage.document(id, "current", context)).rejects.toThrow(
      `Document ${id} is missing a required base`,
    );
  });
});

describe("Pico SqliteStorage", () => {
  it("replays detached root replacements and follow-up edits while rejecting corrupt operations", async () => {
    const { storage, path, id } = await replacedDocument();
    await storage.commit(
      [
        {
          type: "document.change",
          id,
          content: { kind: "delta", version: 1, ops: [["s", ["nested", "value"], 4]] },
        },
      ],
      context,
    );

    const expected = { nested: { value: 4 }, rows: [{ id: 2 }, { id: 1 }] };
    const first = (await storage.document(id, "current", context))!;
    expect(first.value).toEqual(expected);
    (first.value["nested"] as { value: number }).value = 99;
    (first.value["rows"] as Array<{ id: number }>)[0]!.id = 99;
    expect((await storage.document(id, "current", context))?.value).toEqual(expected);

    const database = new DatabaseSync(path);
    try {
      database
        .prepare(`UPDATE document_revisions SET content = ? WHERE document_id = ? AND seq =
					(SELECT max(seq) FROM document_revisions WHERE document_id = ?)`)
        .run('[["unknown"]]', id, id);
    } finally {
      database.close();
    }
    await expect(storage.document(id, "current", context)).rejects.toThrow("unknown op verb");
  });
});
