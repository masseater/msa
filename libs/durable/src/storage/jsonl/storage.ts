import type { Context } from "@msa/chord";
import { Effect } from "effect";

import type { FileSystem } from "../../env/index.ts";
import type {
  ConversationId,
  ConversationQuery,
  Cursor,
  DocumentAddress,
  DocumentId,
  DocumentPoint,
  DocumentQuery,
  EntryId,
  EntryQuery,
  Id,
  Seq,
  Storage,
  StorageWrite,
  SubmissionId,
  SubmissionQuery,
  TaskId,
  TaskQuery,
} from "../../types.ts";
import { forwardEntry } from "../entry-args.ts";
import { MemoryStorage } from "../memory.ts";
import { adoptSidecarState, encodeCommit, planReclamations } from "./encode.ts";
import { appendEncoded, type JsonlFiles, reclaimSidecars, resolveLayout } from "./files.ts";
import { JsonlStoragePoisonedError } from "./poisoned-error.ts";
import { recoverJsonl } from "./recover.ts";

export type JsonlStorageOptions = {
  readonly fsync?: boolean;
};

export class JsonlStorage implements Storage {
  private readonly files: JsonlFiles;
  private readonly memory = new MemoryStorage();
  private readonly currentOnlyDocuments = new Set<DocumentId>();
  private readonly liveTaskSidecars = new Set<TaskId>();
  private closed = false;
  private poisonError: JsonlStoragePoisonedError | undefined;

  private constructor(files: JsonlFiles) {
    this.files = files;
  }

  static open(
    directory: string,
    fs: FileSystem,
    context: Context,
    options: JsonlStorageOptions = {},
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

  commit(writes: readonly StorageWrite[], context: Context): Promise<Seq> {
    return Effect.runPromise(
      Effect.suspend(() => {
        this.assertUsable();
        return this.commitEffect(writes, context);
      }),
    );
  }

  mintId<I extends Id<string>>(): Promise<I> {
    return this.delegate(() => this.store.mintId<I>());
  }

  conversation(id: ConversationId, context: Context) {
    return this.delegate(() => this.store.conversation(id, context));
  }

  scanConversations(
    query: ConversationQuery,
    limit: number,
    cursor: Cursor | undefined,
    context: Context,
  ) {
    return this.delegate(() => this.store.scanConversations(query, limit, cursor, context));
  }

  entry(id: EntryId, context: Context): ReturnType<Storage["entry"]>;
  entry(
    conversationId: ConversationId,
    id: EntryId,
    context: Context,
  ): ReturnType<Storage["entry"]>;
  entry(
    idOrConversationId: EntryId | ConversationId,
    idOrContext: EntryId | Context,
    context?: Context,
  ) {
    return this.delegate(() => forwardEntry(this.store, idOrConversationId, idOrContext, context));
  }

  findLatestHeadMarker(
    conversationId: ConversationId,
    atOrBeforeEntryId: EntryId | undefined,
    context: Context,
  ) {
    return this.delegate(() =>
      this.store.findLatestHeadMarker(conversationId, atOrBeforeEntryId, context),
    );
  }

  scanEntries(query: EntryQuery, limit: number, cursor: Cursor | undefined, context: Context) {
    return this.delegate(() => this.store.scanEntries(query, limit, cursor, context));
  }

  task(id: TaskId, context: Context) {
    return this.delegate(() => this.store.task(id, context));
  }

  scanTasks(query: TaskQuery, limit: number, cursor: Cursor | undefined, context: Context) {
    return this.delegate(() => this.store.scanTasks(query, limit, cursor, context));
  }

  submission(id: SubmissionId, context: Context) {
    return this.delegate(() => this.store.submission(id, context));
  }

  scanSubmissions(
    query: SubmissionQuery,
    limit: number,
    cursor: Cursor | undefined,
    context: Context,
  ) {
    return this.delegate(() => this.store.scanSubmissions(query, limit, cursor, context));
  }

  submissionByRequest(conversationId: ConversationId, requestId: string, context: Context) {
    return this.delegate(() => this.store.submissionByRequest(conversationId, requestId, context));
  }

  findDocument(address: DocumentAddress, at: DocumentPoint, context: Context) {
    return this.delegate(() => this.store.findDocument(address, at, context));
  }

  document(id: DocumentId, at: DocumentPoint, context: Context) {
    return this.delegate(() => this.store.document(id, at, context));
  }

  scanDocuments(query: DocumentQuery, limit: number, cursor: Cursor | undefined, context: Context) {
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

  private commitEffect(writes: readonly StorageWrite[], context: Context): Effect.Effect<Seq> {
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

  private get store(): MemoryStorage {
    this.assertUsable();
    return this.memory;
  }

  private poison(cause: Error): JsonlStoragePoisonedError {
    this.poisonError ??= new JsonlStoragePoisonedError(cause);
    return this.poisonError;
  }

  private assertUsable(): void {
    if (this.closed) throw new Error("JsonlStorage is closed");
    if (this.poisonError !== undefined) throw this.poisonError;
  }
}
