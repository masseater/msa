import type { Context } from "@msa/chord";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import jsonl from "../src/storage/jsonl/index.ts";
import type jsonlTypes from "../src/storage/jsonl/index.types.ts";
import type typesModule from "../src/types.types.ts";
import durableKit from "./durable-kit.ts";
import jsonlStorageSupport from "./jsonl-storage-support.ts";
import support from "./support.ts";

const { envNode: node, ids, testing } = durableKit;

const { JsonlStorage } = jsonl;
const { NodeExecutionEnv } = node;
const { idFromNumber } = ids;
const { registerStorageConformance } = testing;

const { context, openStorage, openStorages, tempDirectories, tempDirectory } = jsonlStorageSupport;
const { awaited, removeDir } = support;

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

const createStorage = Effect.fn("createStorage")(function* () {
  return yield* openStorage(yield* tempDirectory());
});

class ReopeningStorage implements typesModule.Storage {
  private current: jsonlTypes.JsonlStorage;
  private readonly directory: string;
  private closed = false;

  constructor(current: jsonlTypes.JsonlStorage, directory: string) {
    this.current = current;
    this.directory = directory;
  }

  commit(
    writes: readonly typesModule.StorageWrite[],
    commitContext: Context,
  ): Promise<typesModule.Seq> {
    return Effect.runPromise(
      Effect.gen({ self: this }, function* () {
        if (this.closed) return yield* awaited(this.current.commit(writes, commitContext));
        return yield* Effect.gen({ self: this }, function* () {
          return yield* awaited(this.current.commit(writes, commitContext));
        }).pipe(
          Effect.ensuring(
            Effect.gen({ self: this }, function* () {
              yield* awaited(this.current.close(context));
              this.current = yield* awaited(
                JsonlStorage.open(
                  this.directory,
                  new NodeExecutionEnv({ cwd: this.directory }),
                  context,
                ),
              );
            }),
          ),
        );
      }),
    );
  }

  mintId<I extends typesModule.Id<string>>(): Promise<I> {
    return this.current.mintId<I>();
  }
  conversation: typesModule.Storage["conversation"] = (id, readContext) =>
    this.current.conversation(id, readContext);
  scanConversations: typesModule.Storage["scanConversations"] = (
    query,
    limit,
    cursor,
    readContext,
  ) => this.current.scanConversations(query, limit, cursor, readContext);
  entry(id: typesModule.EntryId, readContext: Context): ReturnType<typesModule.Storage["entry"]>;
  entry(
    conversationId: typesModule.ConversationId,
    id: typesModule.EntryId,
    readContext: Context,
  ): ReturnType<typesModule.Storage["entry"]>;
  entry(
    idOrConversationId: typesModule.EntryId | typesModule.ConversationId,
    idOrContext: typesModule.EntryId | Context,
    readContext?: Context,
  ) {
    if (readContext === undefined) {
      return this.current.entry(
        idFromNumber<typesModule.EntryId>(idOrConversationId),
        idOrContext as Context,
      );
    }
    if (typeof idOrContext !== "number")
      throw new TypeError("Storage.entry() requires an entry ID");
    return this.current.entry(
      idFromNumber<typesModule.ConversationId>(idOrConversationId),
      idFromNumber<typesModule.EntryId>(idOrContext),
      readContext,
    );
  }
  findLatestHeadMarker: typesModule.Storage["findLatestHeadMarker"] = (
    conversationId,
    at,
    readContext,
  ) => this.current.findLatestHeadMarker(conversationId, at, readContext);
  scanEntries: typesModule.Storage["scanEntries"] = (query, limit, cursor, readContext) =>
    this.current.scanEntries(query, limit, cursor, readContext);
  task: typesModule.Storage["task"] = (id, readContext) => this.current.task(id, readContext);
  scanTasks: typesModule.Storage["scanTasks"] = (query, limit, cursor, readContext) =>
    this.current.scanTasks(query, limit, cursor, readContext);
  submission: typesModule.Storage["submission"] = (id, readContext) =>
    this.current.submission(id, readContext);
  scanSubmissions: typesModule.Storage["scanSubmissions"] = (query, limit, cursor, readContext) =>
    this.current.scanSubmissions(query, limit, cursor, readContext);
  submissionByRequest: typesModule.Storage["submissionByRequest"] = (
    conversationId,
    requestId,
    readContext,
  ) => this.current.submissionByRequest(conversationId, requestId, readContext);
  findDocument: typesModule.Storage["findDocument"] = (address, at, readContext) =>
    this.current.findDocument(address, at, readContext);
  document: typesModule.Storage["document"] = (id, at, readContext) =>
    this.current.document(id, at, readContext);
  scanDocuments: typesModule.Storage["scanDocuments"] = (query, limit, cursor, readContext) =>
    this.current.scanDocuments(query, limit, cursor, readContext);

  close(closeContext: Context): Promise<void> {
    return Effect.runPromise(
      Effect.gen({ self: this }, function* () {
        if (this.closed) return;
        this.closed = true;
        yield* awaited(this.current.close(closeContext));
      }),
    );
  }
}

registerStorageConformance({ describe, expect, it }, "JsonlStorage", (use) =>
  Effect.runPromise(
    Effect.gen(function* () {
      return yield* awaited(use(yield* createStorage()));
    }),
  ),
);

registerStorageConformance({ describe, expect, it }, "JsonlStorage across reopen", (use) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* tempDirectory("msa-durable-jsonl-conformance-");
      const current = yield* awaited(
        JsonlStorage.open(directory, new NodeExecutionEnv({ cwd: directory }), context),
      );
      const storage = new ReopeningStorage(current, directory);
      yield* Effect.asVoid(Effect.suspend(() => awaited(use(storage)))).pipe(
        Effect.ensuring(Effect.asVoid(Effect.suspend(() => awaited(storage.close(context))))),
      );
    }),
  ),
);
