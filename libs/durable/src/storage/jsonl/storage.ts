import type { Context } from "@msa/chord";
import { Effect } from "effect";

import type typesModule from "../../types.types.ts";
import entryArgs from "../entry-args.ts";
import memoryModule from "../memory.ts";
import encode from "./encode.ts";
import filesModule from "./files.ts";
import JsonlStoragePoisonedError from "./poisoned-error.ts";
import recoverModule from "./recover.ts";
import type storageTypes from "./storage.types.ts";

const { MemoryStorage } = memoryModule;
const { appendEncoded, reclaimSidecars, resolveLayout } = filesModule;
const { forwardEntry } = entryArgs;
const { adoptSidecarState, encodeCommit, planReclamations } = encode;
const { recoverJsonl } = recoverModule;

export default class JsonlStorage implements typesModule.Storage {
  private readonly files: storageTypes.JsonlFiles;
  private readonly memory = new MemoryStorage();
  private readonly currentOnlyDocuments = new Set<typesModule.DocumentId>();
  private readonly liveTaskSidecars = new Set<typesModule.TaskId>();
  private closed = false;
  private poisonError: storageTypes.JsonlStoragePoisonedError | undefined;

  private constructor(files: storageTypes.JsonlFiles) {
    this.files = files;
  }

  static open(
    directory: string,
    fs: storageTypes.FileSystem,
    context: Context,
    options: storageTypes.JsonlStorageOptions = {},
  ): Promise<JsonlStorage> {
    return Effect.runPromise(
      Effect.gen(function* () {
        const layout = yield* resolveLayout(directory, fs, context);
        const storage = new JsonlStorage({ fs, ...layout, fsync: options.fsync ?? false });
        yield* storage.recover(context);
        return storage;
      }),
    );
  }

  commit(writes: readonly typesModule.StorageWrite[], context: Context): Promise<typesModule.Seq> {
    return Effect.runPromise(
      Effect.suspend(() => {
        this.assertUsable();
        return this.commitEffect(writes, context);
      }),
    );
  }

  mintId<I extends typesModule.Id<string>>(): Promise<I> {
    return this.delegate(() => this.store.mintId<I>());
  }

  conversation(id: typesModule.ConversationId, context: Context) {
    return this.delegate(() => this.store.conversation(id, context));
  }

  scanConversations(
    query: typesModule.ConversationQuery,
    limit: number,
    cursor: typesModule.Cursor | undefined,
    context: Context,
  ) {
    return this.delegate(() => this.store.scanConversations(query, limit, cursor, context));
  }

  entry(id: typesModule.EntryId, context: Context): ReturnType<typesModule.Storage["entry"]>;
  entry(
    conversationId: typesModule.ConversationId,
    id: typesModule.EntryId,
    context: Context,
  ): ReturnType<typesModule.Storage["entry"]>;
  entry(
    idOrConversationId: typesModule.EntryId | typesModule.ConversationId,
    idOrContext: typesModule.EntryId | Context,
    context?: Context,
  ) {
    return this.delegate(() => forwardEntry(this.store, idOrConversationId, idOrContext, context));
  }

  findLatestHeadMarker(
    conversationId: typesModule.ConversationId,
    atOrBeforeEntryId: typesModule.EntryId | undefined,
    context: Context,
  ) {
    return this.delegate(() =>
      this.store.findLatestHeadMarker(conversationId, atOrBeforeEntryId, context),
    );
  }

  scanEntries(
    query: typesModule.EntryQuery,
    limit: number,
    cursor: typesModule.Cursor | undefined,
    context: Context,
  ) {
    return this.delegate(() => this.store.scanEntries(query, limit, cursor, context));
  }

  task(id: typesModule.TaskId, context: Context) {
    return this.delegate(() => this.store.task(id, context));
  }

  scanTasks(
    query: typesModule.TaskQuery,
    limit: number,
    cursor: typesModule.Cursor | undefined,
    context: Context,
  ) {
    return this.delegate(() => this.store.scanTasks(query, limit, cursor, context));
  }

  submission(id: typesModule.SubmissionId, context: Context) {
    return this.delegate(() => this.store.submission(id, context));
  }

  scanSubmissions(
    query: typesModule.SubmissionQuery,
    limit: number,
    cursor: typesModule.Cursor | undefined,
    context: Context,
  ) {
    return this.delegate(() => this.store.scanSubmissions(query, limit, cursor, context));
  }

  submissionByRequest(
    conversationId: typesModule.ConversationId,
    requestId: string,
    context: Context,
  ) {
    return this.delegate(() => this.store.submissionByRequest(conversationId, requestId, context));
  }

  findDocument(
    address: typesModule.DocumentAddress,
    at: typesModule.DocumentPoint,
    context: Context,
  ) {
    return this.delegate(() => this.store.findDocument(address, at, context));
  }

  document(id: typesModule.DocumentId, at: typesModule.DocumentPoint, context: Context) {
    return this.delegate(() => this.store.document(id, at, context));
  }

  scanDocuments(
    query: typesModule.DocumentQuery,
    limit: number,
    cursor: typesModule.Cursor | undefined,
    context: Context,
  ) {
    return this.delegate(() => this.store.scanDocuments(query, limit, cursor, context));
  }

  close(context: Context): Promise<void> {
    return Effect.runPromise(
      Effect.suspend(() => {
        if (this.closed) return Effect.void;
        this.closed = true;
        return Effect.promise(() => this.memory.close(context));
      }),
    );
  }

  private commitEffect(
    writes: readonly typesModule.StorageWrite[],
    context: Context,
  ): Effect.Effect<typesModule.Seq> {
    return Effect.gen({ self: this }, function* () {
      const prepared = this.memory.prepareCommit(writes);
      const encoded = encodeCommit(prepared.seq, prepared.writes);
      const reclamations = planReclamations(
        {
          currentOnlyDocuments: this.currentOnlyDocuments,
          liveTaskSidecars: this.liveTaskSidecars,
        },
        prepared.writes,
        encoded,
      );
      const failure = yield* appendEncoded(this.files, encoded, context);
      if (failure !== undefined) throw this.poison(failure);
      const seq = prepared.apply();
      adoptSidecarState(
        {
          currentOnlyDocuments: this.currentOnlyDocuments,
          liveTaskSidecars: this.liveTaskSidecars,
        },
        prepared.writes,
      );
      yield* reclaimSidecars(this.files, reclamations, context);
      return seq;
    });
  }

  private recover(context: Context): Effect.Effect<void> {
    return Effect.gen({ self: this }, function* () {
      const analysis = yield* recoverJsonl(this.files, this.memory, context);
      for (const id of analysis.currentOnlyDocuments) this.currentOnlyDocuments.add(id);
      for (const [id, live] of analysis.finalTaskIsLive) {
        if (live) this.liveTaskSidecars.add(id);
      }
    });
  }

  private delegate<T>(read: () => Promise<T>): Promise<T> {
    return Effect.runPromise(Effect.promise(read));
  }

  private get store(): storageTypes.MemoryStorage {
    this.assertUsable();
    return this.memory;
  }

  private poison(cause: Error): storageTypes.JsonlStoragePoisonedError {
    this.poisonError ??= new JsonlStoragePoisonedError(cause);
    return this.poisonError;
  }

  private assertUsable(): void {
    if (this.closed) throw new Error("JsonlStorage is closed");
    if (this.poisonError !== undefined) throw this.poisonError;
  }
}
