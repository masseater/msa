import { DatabaseSync } from "node:sqlite";

import type { Context, JsonValue } from "@msa/chord";
import type durableTypes from "@msa/durable/index.types";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import durableKit from "./durable-kit.ts";
import sqliteStorageSupport from "./sqlite-storage-support.ts";
import type sqliteStorageSupportTypes from "./sqlite-storage-support.types.ts";
import support from "./support.ts";

const { durable, ids, testing } = durableKit;

const { idFromNumber } = ids;
const { registerStorageConformance } = testing;
const { ROOT_CONVERSATION_ID } = durable;

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

class ReopeningStorage implements durableTypes.Storage {
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
    writes: readonly durableTypes.StorageWrite[],
    commitContext: Parameters<durableTypes.Storage["commit"]>[1],
  ): Promise<durableTypes.Seq> {
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

  mintId<I extends durableTypes.Id<string>>(): Promise<I> {
    return this.current.mintId<I>();
  }
  conversation: durableTypes.Storage["conversation"] = (id, readContext) =>
    this.current.conversation(id, readContext);
  scanConversations: durableTypes.Storage["scanConversations"] = (
    query,
    limit,
    cursor,
    readContext,
  ) => this.current.scanConversations(query, limit, cursor, readContext);
  entry(id: durableTypes.EntryId, readContext: Context): ReturnType<durableTypes.Storage["entry"]>;
  entry(
    conversationId: durableTypes.ConversationId,
    id: durableTypes.EntryId,
    readContext: Context,
  ): ReturnType<durableTypes.Storage["entry"]>;
  entry(
    idOrConversationId: durableTypes.EntryId | durableTypes.ConversationId,
    idOrContext: durableTypes.EntryId | Context,
    readContext?: Context,
  ) {
    if (readContext === undefined) {
      return this.current.entry(
        idFromNumber<durableTypes.EntryId>(idOrConversationId),
        idOrContext as Context,
      );
    }
    if (typeof idOrContext !== "number")
      throw new TypeError("Storage.entry() requires an entry ID");
    return this.current.entry(
      idFromNumber<durableTypes.ConversationId>(idOrConversationId),
      idFromNumber<durableTypes.EntryId>(idOrContext),
      readContext,
    );
  }
  findLatestHeadMarker: durableTypes.Storage["findLatestHeadMarker"] = (
    conversationId,
    at,
    readContext,
  ) => this.current.findLatestHeadMarker(conversationId, at, readContext);
  scanEntries: durableTypes.Storage["scanEntries"] = (query, limit, cursor, readContext) =>
    this.current.scanEntries(query, limit, cursor, readContext);
  task: durableTypes.Storage["task"] = (id, readContext) => this.current.task(id, readContext);
  scanTasks: durableTypes.Storage["scanTasks"] = (query, limit, cursor, readContext) =>
    this.current.scanTasks(query, limit, cursor, readContext);
  submission: durableTypes.Storage["submission"] = (id, readContext) =>
    this.current.submission(id, readContext);
  scanSubmissions: durableTypes.Storage["scanSubmissions"] = (query, limit, cursor, readContext) =>
    this.current.scanSubmissions(query, limit, cursor, readContext);
  submissionByRequest: durableTypes.Storage["submissionByRequest"] = (
    conversationId,
    requestId,
    readContext,
  ) => this.current.submissionByRequest(conversationId, requestId, readContext);
  findDocument: durableTypes.Storage["findDocument"] = (address, at, readContext) =>
    this.current.findDocument(address, at, readContext);
  document: durableTypes.Storage["document"] = (id, at, readContext) =>
    this.current.document(id, at, readContext);
  scanDocuments: durableTypes.Storage["scanDocuments"] = (query, limit, cursor, readContext) =>
    this.current.scanDocuments(query, limit, cursor, readContext);

  close(closeContext: Parameters<durableTypes.Storage["close"]>[0]): Promise<void> {
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
  const entryId = yield* awaited(storage.mintId<durableTypes.EntryId>());
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
  expect(yield* awaited(reopened.mintId<durableTypes.EntryId>())).toBe(entryId + 1);
  expect(
    yield* awaited(
      reopened.commit(
        [
          {
            type: "task",
            value: pendingTask(yield* awaited(reopened.mintId<durableTypes.TaskId<JsonValue>>())),
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
