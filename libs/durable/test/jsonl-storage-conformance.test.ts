import type { Context } from "@msa/chord";
import { registerStorageConformance } from "@msa/durable/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { NodeExecutionEnv } from "../src/env/node.ts";
import { idFromNumber } from "../src/ids.ts";
import { JsonlStorage } from "../src/storage/jsonl/index.ts";
import type { ConversationId, EntryId, Id, Seq, Storage, StorageWrite } from "../src/types.ts";
import jsonlStorageSupport from "./jsonl-storage-support.ts";
import support from "./support.ts";

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

class ReopeningStorage implements Storage {
  private current: JsonlStorage;
  private readonly directory: string;
  private closed = false;

  constructor(current: JsonlStorage, directory: string) {
    this.current = current;
    this.directory = directory;
  }

  commit(writes: readonly StorageWrite[], commitContext: Context): Promise<Seq> {
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
