import type { Context, JsonValue } from "@msa/chord";
import { Deferred, Effect } from "effect";

import errors from "../errors.ts";
import promiseTryModule from "../promise-try.ts";
import type typesModule from "../types.types.ts";
import type guardedStorageTypes from "./guarded-storage.types.ts";

const { promiseTry } = promiseTryModule;
const { SessionFailed, StorageRequestError } = errors;

type EntryRead = { readonly entry: typesModule.EntryRecord; readonly commitSeq: typesModule.Seq };
type AnyTaskRecord = typesModule.TaskRecord<JsonValue, JsonValue, JsonValue>;

export default class GuardedStorage implements typesModule.Storage {
  readonly #storage: typesModule.Storage;
  readonly #latch: guardedStorageTypes.FailureLatch;
  #underway = 0;
  #drained: Deferred.Deferred<void> | undefined;
  #closing = false;

  constructor(storage: typesModule.Storage, latch: guardedStorageTypes.FailureLatch) {
    this.#storage = storage;
    this.#latch = latch;
  }

  commit(writes: readonly typesModule.StorageWrite[], context: Context): Promise<typesModule.Seq> {
    return this.#call(undefined, () => this.#storage.commit(writes, context));
  }

  mintId<I extends typesModule.Id<string>>(): Promise<I> {
    return this.#call(undefined, () => this.#storage.mintId<I>());
  }

  conversation(
    id: typesModule.ConversationId,
    context: Context,
  ): Promise<typesModule.ConversationRecord | undefined> {
    return this.#call(context, () => this.#storage.conversation(id, context));
  }

  scanConversations(
    query: typesModule.ConversationQuery,
    limit: number,
    cursor: typesModule.Cursor | undefined,
    context: Context,
  ): Promise<typesModule.Page<typesModule.ConversationRecord, typesModule.Cursor>> {
    return this.#call(context, () =>
      this.#storage.scanConversations(query, limit, cursor, context),
    );
  }

  entry(id: typesModule.EntryId, context: Context): Promise<EntryRead | undefined>;
  entry(
    conversationId: typesModule.ConversationId,
    id: typesModule.EntryId,
    context: Context,
  ): Promise<EntryRead | undefined>;
  entry(
    first: typesModule.EntryId | typesModule.ConversationId,
    second: typesModule.EntryId | Context,
    third?: Context,
  ): Promise<EntryRead | undefined> {
    if (third === undefined) {
      const context = second as Context;
      return this.#call(context, () => this.#storage.entry(first as typesModule.EntryId, context));
    }
    return this.#call(third, () =>
      this.#storage.entry(
        first as typesModule.ConversationId,
        second as typesModule.EntryId,
        third,
      ),
    );
  }

  findLatestHeadMarker(
    conversationId: typesModule.ConversationId,
    atOrBeforeEntryId: typesModule.EntryId | undefined,
    context: Context,
  ): Promise<(typesModule.EntryRecord & { readonly head: typesModule.EntryId }) | undefined> {
    return this.#call(context, () =>
      this.#storage.findLatestHeadMarker(conversationId, atOrBeforeEntryId, context),
    );
  }

  scanEntries(
    query: typesModule.EntryQuery,
    limit: number,
    cursor: typesModule.Cursor | undefined,
    context: Context,
  ): Promise<typesModule.Page<typesModule.EntryRecord, typesModule.Cursor>> {
    return this.#call(context, () => this.#storage.scanEntries(query, limit, cursor, context));
  }

  task(id: typesModule.TaskId, context: Context): Promise<AnyTaskRecord | undefined> {
    return this.#call(context, () => this.#storage.task(id, context));
  }

  scanTasks(
    query: typesModule.TaskQuery,
    limit: number,
    cursor: typesModule.Cursor | undefined,
    context: Context,
  ): Promise<typesModule.Page<AnyTaskRecord, typesModule.Cursor>> {
    return this.#call(context, () => this.#storage.scanTasks(query, limit, cursor, context));
  }

  submission(
    id: typesModule.SubmissionId,
    context: Context,
  ): Promise<typesModule.SubmissionRecord | undefined> {
    return this.#call(context, () => this.#storage.submission(id, context));
  }

  scanSubmissions(
    query: typesModule.SubmissionQuery,
    limit: number,
    cursor: typesModule.Cursor | undefined,
    context: Context,
  ): Promise<typesModule.Page<typesModule.SubmissionRecord, typesModule.Cursor>> {
    return this.#call(context, () => this.#storage.scanSubmissions(query, limit, cursor, context));
  }

  submissionByRequest(
    conversationId: typesModule.ConversationId,
    requestId: string,
    context: Context,
  ): Promise<typesModule.SubmissionRecord | undefined> {
    return this.#call(context, () =>
      this.#storage.submissionByRequest(conversationId, requestId, context),
    );
  }

  findDocument(
    address: typesModule.DocumentAddress,
    at: typesModule.DocumentPoint,
    context: Context,
  ): Promise<typesModule.DocumentRecord | undefined> {
    return this.#call(context, () => this.#storage.findDocument(address, at, context));
  }

  document(
    id: typesModule.DocumentId,
    at: typesModule.DocumentPoint,
    context: Context,
  ): Promise<typesModule.StoredDocument | undefined> {
    return this.#call(context, () => this.#storage.document(id, at, context));
  }

  scanDocuments(
    query: typesModule.DocumentQuery,
    limit: number,
    cursor: typesModule.Cursor | undefined,
    context: Context,
  ): Promise<typesModule.Page<typesModule.DocumentRecord, typesModule.Cursor>> {
    return this.#call(context, () => this.#storage.scanDocuments(query, limit, cursor, context));
  }

  close(context: Context): Promise<void> {
    this.#closing = true;
    return Effect.runPromise(
      Effect.andThen(
        this.#drain(),
        Effect.promise(() => this.#storage.close(context)),
      ),
    );
  }

  #drain(): Effect.Effect<void> {
    if (this.#underway === 0) return Effect.void;
    const drained = Deferred.makeUnsafe<void>();
    this.#drained = drained;
    return Deferred.await(drained);
  }

  #settle(): void {
    this.#underway -= 1;
    if (this.#underway === 0 && this.#drained !== undefined) {
      Deferred.doneUnsafe(this.#drained, Effect.void);
    }
  }

  #call<T>(read: Context | undefined, run: () => Promise<T>): Promise<T> {
    try {
      this.#assertHealthy();
      if (this.#closing) throw new Error("Session is closed");
    } catch (error) {
      return Promise.reject(error);
    }
    this.#underway += 1;
    return promiseTry(run).then(
      (value) => {
        this.#settle();
        this.#assertHealthy();
        return value;
      },
      (error: unknown) => {
        try {
          throw this.#failed(read, error);
        } finally {
          this.#settle();
        }
      },
    );
  }

  #failed(read: Context | undefined, error: unknown): unknown {
    this.#assertHealthy();
    const exempt =
      read !== undefined &&
      (error instanceof StorageRequestError || read.abortSignal?.aborted === true);
    if (!exempt) this.#latch.fail(error);
    return error;
  }

  #assertHealthy(): void {
    const failure = this.#latch.failure;
    if (failure !== undefined) throw new SessionFailed(failure.error);
  }
}
