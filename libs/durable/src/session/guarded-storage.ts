import type { Context, JsonValue } from "@msa/chord";
import { Deferred, Effect } from "effect";

import { SessionFailed, StorageRequestError } from "../errors.ts";
import { promiseTry } from "../promise-try.ts";
import type {
  ConversationId,
  ConversationQuery,
  ConversationRecord,
  Cursor,
  DocumentAddress,
  DocumentId,
  DocumentPoint,
  DocumentQuery,
  DocumentRecord,
  EntryId,
  EntryQuery,
  EntryRecord,
  Id,
  Page,
  Seq,
  Storage,
  StorageWrite,
  StoredDocument,
  SubmissionId,
  SubmissionQuery,
  SubmissionRecord,
  TaskId,
  TaskQuery,
  TaskRecord,
} from "../types.ts";

export type FailureLatch = {
  readonly failure: { readonly error: unknown } | undefined;
  fail(error: unknown): void;
};

type EntryRead = { readonly entry: EntryRecord; readonly commitSeq: Seq };
type AnyTaskRecord = TaskRecord<JsonValue, JsonValue, JsonValue>;

export class GuardedStorage implements Storage {
  readonly #storage: Storage;
  readonly #latch: FailureLatch;
  #underway = 0;
  #drained: Deferred.Deferred<void> | undefined;
  #closing = false;

  constructor(storage: Storage, latch: FailureLatch) {
    this.#storage = storage;
    this.#latch = latch;
  }

  commit(writes: readonly StorageWrite[], context: Context): Promise<Seq> {
    return this.#call(undefined, () => this.#storage.commit(writes, context));
  }

  mintId<I extends Id<string>>(): Promise<I> {
    return this.#call(undefined, () => this.#storage.mintId<I>());
  }

  conversation(id: ConversationId, context: Context): Promise<ConversationRecord | undefined> {
    return this.#call(context, () => this.#storage.conversation(id, context));
  }

  scanConversations(
    query: ConversationQuery,
    limit: number,
    cursor: Cursor | undefined,
    context: Context,
  ): Promise<Page<ConversationRecord, Cursor>> {
    return this.#call(context, () =>
      this.#storage.scanConversations(query, limit, cursor, context),
    );
  }

  entry(id: EntryId, context: Context): Promise<EntryRead | undefined>;
  entry(
    conversationId: ConversationId,
    id: EntryId,
    context: Context,
  ): Promise<EntryRead | undefined>;
  entry(
    first: EntryId | ConversationId,
    second: EntryId | Context,
    third?: Context,
  ): Promise<EntryRead | undefined> {
    if (third === undefined) {
      const context = second as Context;
      return this.#call(context, () => this.#storage.entry(first as EntryId, context));
    }
    return this.#call(third, () =>
      this.#storage.entry(first as ConversationId, second as EntryId, third),
    );
  }

  findLatestHeadMarker(
    conversationId: ConversationId,
    atOrBeforeEntryId: EntryId | undefined,
    context: Context,
  ): Promise<(EntryRecord & { readonly head: EntryId }) | undefined> {
    return this.#call(context, () =>
      this.#storage.findLatestHeadMarker(conversationId, atOrBeforeEntryId, context),
    );
  }

  scanEntries(
    query: EntryQuery,
    limit: number,
    cursor: Cursor | undefined,
    context: Context,
  ): Promise<Page<EntryRecord, Cursor>> {
    return this.#call(context, () => this.#storage.scanEntries(query, limit, cursor, context));
  }

  task(id: TaskId, context: Context): Promise<AnyTaskRecord | undefined> {
    return this.#call(context, () => this.#storage.task(id, context));
  }

  scanTasks(
    query: TaskQuery,
    limit: number,
    cursor: Cursor | undefined,
    context: Context,
  ): Promise<Page<AnyTaskRecord, Cursor>> {
    return this.#call(context, () => this.#storage.scanTasks(query, limit, cursor, context));
  }

  submission(id: SubmissionId, context: Context): Promise<SubmissionRecord | undefined> {
    return this.#call(context, () => this.#storage.submission(id, context));
  }

  scanSubmissions(
    query: SubmissionQuery,
    limit: number,
    cursor: Cursor | undefined,
    context: Context,
  ): Promise<Page<SubmissionRecord, Cursor>> {
    return this.#call(context, () => this.#storage.scanSubmissions(query, limit, cursor, context));
  }

  submissionByRequest(
    conversationId: ConversationId,
    requestId: string,
    context: Context,
  ): Promise<SubmissionRecord | undefined> {
    return this.#call(context, () =>
      this.#storage.submissionByRequest(conversationId, requestId, context),
    );
  }

  findDocument(
    address: DocumentAddress,
    at: DocumentPoint,
    context: Context,
  ): Promise<DocumentRecord | undefined> {
    return this.#call(context, () => this.#storage.findDocument(address, at, context));
  }

  document(
    id: DocumentId,
    at: DocumentPoint,
    context: Context,
  ): Promise<StoredDocument | undefined> {
    return this.#call(context, () => this.#storage.document(id, at, context));
  }

  scanDocuments(
    query: DocumentQuery,
    limit: number,
    cursor: Cursor | undefined,
    context: Context,
  ): Promise<Page<DocumentRecord, Cursor>> {
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
