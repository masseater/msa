import { DatabaseSync } from "node:sqlite";

import type { Context, JsonValue } from "@msa/chord";
import {
  type ConversationId,
  type EntryId,
  type Id,
  ROOT_CONVERSATION_ID,
  type Seq,
  type Storage,
  type StorageWrite,
  type TaskId,
} from "@msa/durable";
import { registerStorageConformance } from "@msa/durable/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { idFromNumber } from "../src/ids.ts";
import sqliteStorageSupport from "./sqlite-storage-support.ts";
import type sqliteStorageSupportTypes from "./sqlite-storage-support.types.ts";
import support from "./support.ts";

const {
  context,
  createRoot,
  createSqliteStorage,
  entry,
  openNodeSqliteStorage,
  openStorages,
  pendingTask,
  tempDirectories,
} = sqliteStorageSupport;
const { awaited, makeTempFile, removeDir } = support;

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

class ReopeningStorage implements Storage {
  private current: sqliteStorageSupportTypes.SqliteStorage;
  private readonly path: string;
  private readonly options: sqliteStorageSupportTypes.NodeSqliteStorageOptions;
  private closed = false;

  constructor(
    current: sqliteStorageSupportTypes.SqliteStorage,
    path: string,
    options: sqliteStorageSupportTypes.NodeSqliteStorageOptions = {},
  ) {
    this.current = current;
    this.path = path;
    this.options = options;
  }

  commit(
    writes: readonly StorageWrite[],
    commitContext: Parameters<Storage["commit"]>[1],
  ): Promise<Seq> {
    return Effect.runPromise(
      Effect.gen({ self: this }, function* () {
        if (this.closed) return yield* awaited(this.current.commit(writes, commitContext));
        return yield* Effect.gen({ self: this }, function* () {
          return yield* awaited(this.current.commit(writes, commitContext));
        }).pipe(
          Effect.ensuring(
            Effect.gen({ self: this }, function* () {
              yield* awaited(this.current.close(context));
              this.current = yield* awaited(openNodeSqliteStorage(this.path, this.options));
            }),
          ),
        );
      }),
    );
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

  close(closeContext: Parameters<Storage["close"]>[0]): Promise<void> {
    return Effect.runPromise(
      Effect.gen({ self: this }, function* () {
        if (this.closed) return;
        this.closed = true;
        yield* awaited(this.current.close(closeContext));
      }),
    );
  }
}

registerStorageConformance({ describe, expect, it }, "SqliteStorage", (use) =>
  Effect.runPromise(
    Effect.gen(function* () {
      return yield* awaited(use((yield* createSqliteStorage()).storage));
    }),
  ),
);

registerStorageConformance({ describe, expect, it }, "SqliteStorage across reopen", (use) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { directory, path } = yield* makeTempFile(
        "msa-durable-sqlite-conformance-",
        "storage.sqlite",
      );
      const created = yield* awaited(openNodeSqliteStorage(path));
      yield* awaited(created.close(context));
      const storage = new ReopeningStorage(yield* awaited(openNodeSqliteStorage(path)), path);
      yield* Effect.asVoid(Effect.suspend(() => awaited(use(storage)))).pipe(
        Effect.ensuring(
          Effect.gen(function* () {
            yield* awaited(storage.close(context));
            yield* removeDir(directory);
          }),
        ),
      );
    }),
  ),
);

const persistsRecordsSequence = Effect.gen(function* () {
  const { storage, path } = yield* createSqliteStorage();
  expect(yield* awaited(createRoot(storage))).toBe(1);
  const entryId = yield* awaited(storage.mintId<EntryId>());
  expect(
    yield* awaited(
      storage.commit(
        [{ type: "entry", value: entry(entryId, ROOT_CONVERSATION_ID, undefined) }],
        context,
      ),
    ),
  ).toBe(2);
  yield* awaited(storage.close(context));
  openStorages.delete(storage);

  const reopened = yield* awaited(openNodeSqliteStorage(path));
  openStorages.add(reopened);
  expect(yield* awaited(reopened.entry(entryId, context))).toEqual({
    commitSeq: 2,
    entry: entry(entryId, ROOT_CONVERSATION_ID, undefined),
  });
  expect(yield* awaited(reopened.mintId<EntryId>())).toBe(entryId + 1);
  expect(
    yield* awaited(
      reopened.commit(
        [
          {
            type: "task",
            value: pendingTask(yield* awaited(reopened.mintId<TaskId<JsonValue>>())),
          },
        ],
        context,
      ),
    ),
  ).toBe(3);
});

const rejectsPersistedMetadata = Effect.gen(function* () {
  const { storage, path } = yield* createSqliteStorage();
  yield* awaited(storage.close(context));
  openStorages.delete(storage);
  const database = new DatabaseSync(path);
  try {
    database.exec("DELETE FROM durable_metadata");
  } finally {
    database.close();
  }
  yield* awaited(
    expect(openNodeSqliteStorage(path)).rejects.toThrow("Durable SQLite metadata is missing"),
  );
});

describe("Pico SqliteStorage", () => {
  it("persists records, sequence allocation, and global ID allocation across reopen", () =>
    Effect.runPromise(persistsRecordsSequence));

  it("rejects persisted metadata corruption on reopen", () =>
    Effect.runPromise(rejectsPersistedMetadata));
});
