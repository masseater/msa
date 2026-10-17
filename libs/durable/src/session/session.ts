import { type Context, type JsonValue, replicatedState } from "@msa/chord";
import { awaitWithContext, BACKGROUND_CONTEXT, withoutAbortSignal } from "@msa/chord/context";
import { type Op, track } from "@msa/chord/delta";

import {
  type AnyDocToken,
  addressId as documentAddressId,
  checkRecordScope,
  checkRecordVersion,
  materializeDocument,
  resolveAddress,
} from "../documents.ts";
import { SessionFailed, StorageRequestError } from "../errors.ts";
import { idFromNumber } from "../ids.ts";
import { promiseTry } from "../promise-try.ts";
import type {
  CommitChange,
  CommitPublication,
  ConversationDocFamilyToken,
  ConversationDocToken,
  ConversationId,
  ConversationQuery,
  ConversationRecord,
  Cursor,
  DocumentAddress,
  DocumentCommitChange,
  DocumentId,
  DocumentPoint,
  DocumentQuery,
  DocumentRecord,
  DocumentState,
  DocumentWatch,
  EntryId,
  EntryQuery,
  EntryRecord,
  Id,
  JsonObject,
  Page,
  RewindableConversationDocFamilyToken,
  RewindableConversationDocToken,
  Seq,
  Session,
  SessionDocFamilyToken,
  SessionDocToken,
  SessionEnd,
  Storage,
  StorageWrite,
  StoredDocument,
  SubmissionId,
  SubmissionQuery,
  SubmissionRecord,
  TaskDocFamilyToken,
  TaskDocToken,
  TaskId,
  TaskQuery,
  TaskRecord,
  Tx,
} from "../types.ts";
import {
  CommittedStateSource,
  CommittedWatch,
  type ObservedDocumentValue,
  RETIREMENT_OPERATIONS,
} from "./observation.ts";
import {
  type LoadedDocument,
  Transaction,
  type TransactionHost,
  type TransactionScope,
} from "./transaction.ts";

export function createSession(
  storage: Storage,
  options?: { readonly now?: () => number; readonly documentRetentionMs?: number },
): Session {
  const retention = options?.documentRetentionMs;
  return new SessionImpl(
    storage,
    options?.now,
    retention === undefined ? undefined : () => retention,
  );
}

let defaultRetention = 600_000;

export function setDefaultDocumentRetention(ms: number): void {
  defaultRetention = ms;
}

export function documentRetention(ms: number | undefined): number {
  return typeof ms === "number" && ms >= 0 ? ms : defaultRetention;
}

const MAX_TIMER_DELAY = 2_147_483_647;

export class SessionImpl implements Session {
  readonly #storage: Storage;
  readonly #documents = new Map<string, LoadedDocument>();
  readonly #idleDocuments = new Map<string, number>();
  readonly #attachedDocuments = new Map<DocumentId, number>();
  readonly #clock: () => number;
  readonly #documentRetentionMs: () => number;
  #documentSweep:
    | { readonly at: number; readonly timer: ReturnType<typeof setTimeout> | undefined }
    | undefined;
  #sweepJobs = 0;
  #documentTimersUnavailable = false;
  readonly #commitListeners = new Set<(publication: CommitPublication, context: Context) => void>();
  readonly #internalListeners = new Set<
    (publication: CommitPublication, context: Context) => void
  >();
  readonly #closeListeners = new Set<() => void>();
  readonly #host: TransactionHost;
  #tail: Promise<void> = Promise.resolve();
  #closing: Promise<void> | undefined;
  #failure: { readonly error: unknown } | undefined;
  readonly #failed = Promise.withResolvers<never>();
  readonly #closed = Promise.withResolvers<SessionEnd>();

  get closed(): Promise<SessionEnd> {
    return this.#closed.promise;
  }

  get failure(): { readonly error: unknown } | undefined {
    return this.#failure;
  }

  get failed(): Promise<never> {
    return this.#failed.promise;
  }

  constructor(
    storage: Storage,
    now: () => number = Date.now,
    documentRetentionMs: () => number | undefined = () => undefined,
  ) {
    this.#failed.promise.catch(() => {});
    this.#storage = new GuardedStorage(storage, this);
    this.#clock = () => {
      try {
        return now();
      } catch {
        return Date.now();
      }
    };
    this.#documentRetentionMs = () => {
      try {
        return documentRetention(documentRetentionMs());
      } catch {
        return documentRetention(undefined);
      }
    };
    this.#host = {
      storage: this.#storage,
      now,
      cached: (id) => {
        const cached = this.#documents.get(id);
        if (cached !== undefined) this.#touchDocument(id);
        return cached;
      },
      load: (definition, addressId, address, context) =>
        this.#loadDocument(definition, addressId, address, context),
      install: (document) => {
        this.#documents.set(document.addressId, document);
        this.#touchDocument(document.addressId);
      },
      evict: (id, recordId) => {
        if (this.#documents.get(id)?.record.id === recordId) this.#dropDocument(id);
      },
      conversationCreated: (tx, record) => this.conversationCreated(tx, record),
    };
  }

  protected get storage(): Storage {
    return this.#storage;
  }

  commit<T>(change: (tx: Tx) => T | Promise<T>, context: Context): Promise<T> {
    return this.commitWith(change, context);
  }

  fail(error: unknown): void {
    if (this.#failure !== undefined) return;
    this.#failure = { error };
    this.#failed.reject(new SessionFailed(error));
    // oxlint-disable-next-line promise/no-promise-in-callback -- close を待たないのは意図的な fire-and-forget（呼び出し側が待つ）
    this.close(BACKGROUND_CONTEXT).catch(() => {});
    this.report(error);
  }

  commitWith<T>(
    change: (tx: Transaction) => T | Promise<T>,
    context: Context,
    scope?: TransactionScope,
  ): Promise<T> {
    try {
      this.assertUsable();
    } catch (error) {
      return Promise.reject(error);
    }
    return this.#enqueue(() => this.#runCommit(change, context, scope));
  }

  readOnLine<T>(job: () => Promise<T>): Promise<T> {
    try {
      this.assertUsable();
    } catch (error) {
      return Promise.reject(error);
    }
    return this.#enqueue(() =>
      promiseTry(() => {
        this.#assertHealthy();
        return job();
      }),
    );
  }

  async conversationDocumentOnLine(
    token: ConversationDocToken<JsonObject>,
    conversationId: ConversationId,
    context: Context,
  ): Promise<
    | { readonly record: DocumentRecord; readonly version: number; readonly value: JsonObject }
    | undefined
  > {
    const definition = token.definition;
    const resolved = resolveAddress(definition, [conversationId, context]);
    const loaded = await this.#loadDocument(definition, resolved.id, resolved.address, context);
    if (loaded === undefined) return undefined;
    checkRecordScope(definition, loaded.record);
    checkRecordVersion(definition, loaded.record, loaded.storedVersion);
    return { record: loaded.record, version: loaded.valueVersion, value: loaded.tracker.value };
  }

  snapshot<T extends JsonObject>(
    token: SessionDocToken<T>,
    context: Context,
  ): Promise<Readonly<T> | undefined>;
  snapshot<T extends JsonObject>(
    token: ConversationDocToken<T>,
    conversationId: ConversationId,
    context: Context,
  ): Promise<Readonly<T> | undefined>;
  snapshot<T extends JsonObject>(
    token: TaskDocToken<T>,
    taskId: TaskId,
    context: Context,
  ): Promise<Readonly<T> | undefined>;
  snapshot<T extends JsonObject, I extends JsonValue>(
    token: SessionDocFamilyToken<T, I>,
    key: string,
    context: Context,
  ): Promise<Readonly<T> | undefined>;
  snapshot<T extends JsonObject, I extends JsonValue>(
    token: ConversationDocFamilyToken<T, I>,
    conversationId: ConversationId,
    key: string,
    context: Context,
  ): Promise<Readonly<T> | undefined>;
  snapshot<T extends JsonObject, I extends JsonValue>(
    token: TaskDocFamilyToken<T, I>,
    taskId: TaskId,
    key: string,
    context: Context,
  ): Promise<Readonly<T> | undefined>;
  async snapshot(token: AnyDocToken, ...args: readonly unknown[]): Promise<JsonObject | undefined> {
    this.assertUsable();
    const definition = token.definition;
    const resolved = resolveAddress(definition, args);
    const context = args[resolved.nextArgument] as Context;
    const cached = this.#documents.get(resolved.id);
    if (cached?.valueVersion === definition.version) this.#touchDocument(resolved.id);
    const loaded =
      cached?.valueVersion === definition.version
        ? cached
        : await this.#enqueue(() =>
            promiseTry(() => {
              this.#assertHealthy();
              return this.#loadDocument(definition, resolved.id, resolved.address, context);
            }),
          );
    if (loaded === undefined) return undefined;
    checkRecordScope(definition, loaded.record);
    checkRecordVersion(definition, loaded.record, loaded.storedVersion);
    return loaded.tracker.value;
  }

  documentState<T extends JsonObject>(
    token: SessionDocToken<T>,
    context: Context,
  ): Promise<DocumentState<T> | undefined>;
  documentState<T extends JsonObject>(
    token: ConversationDocToken<T>,
    conversationId: ConversationId,
    context: Context,
  ): Promise<DocumentState<T> | undefined>;
  documentState<T extends JsonObject>(
    token: TaskDocToken<T>,
    taskId: TaskId,
    context: Context,
  ): Promise<DocumentState<T> | undefined>;
  documentState<T extends JsonObject, I extends JsonValue>(
    token: SessionDocFamilyToken<T, I>,
    key: string,
    context: Context,
  ): Promise<DocumentState<T> | undefined>;
  documentState<T extends JsonObject, I extends JsonValue>(
    token: ConversationDocFamilyToken<T, I>,
    conversationId: ConversationId,
    key: string,
    context: Context,
  ): Promise<DocumentState<T> | undefined>;
  documentState<T extends JsonObject, I extends JsonValue>(
    token: TaskDocFamilyToken<T, I>,
    taskId: TaskId,
    key: string,
    context: Context,
  ): Promise<DocumentState<T> | undefined>;
  documentState(
    token: AnyDocToken,
    ...args: readonly unknown[]
  ): Promise<DocumentState<JsonObject> | undefined> {
    try {
      this.assertUsable();
      const definition = token.definition;
      const resolved = resolveAddress(definition, args);
      const context = args[resolved.nextArgument] as Context;
      return this.#enqueue(async () => {
        this.#assertHealthy();
        const loaded = await this.#loadDocument(definition, resolved.id, resolved.address, context);
        if (loaded === undefined) return undefined;
        const { observer: source, detach } = this.#attachDocument(
          definition,
          loaded,
          (value, release) => new CommittedStateSource<ObservedDocumentValue>(value, release),
        );
        try {
          return replicatedState(source, {
            onError: (error) => this.report(error),
          }) as DocumentState<JsonObject>;
        } catch (error) {
          detach();
          throw error;
        }
      });
    } catch (error) {
      return Promise.reject(error);
    }
  }

  watchDoc<T extends JsonObject>(
    token: SessionDocToken<T>,
    context: Context,
  ): Promise<DocumentWatch<T> | undefined>;
  watchDoc<T extends JsonObject>(
    token: ConversationDocToken<T>,
    conversationId: ConversationId,
    context: Context,
  ): Promise<DocumentWatch<T> | undefined>;
  watchDoc<T extends JsonObject>(
    token: TaskDocToken<T>,
    taskId: TaskId,
    context: Context,
  ): Promise<DocumentWatch<T> | undefined>;
  watchDoc<T extends JsonObject, I extends JsonValue>(
    token: SessionDocFamilyToken<T, I>,
    key: string,
    context: Context,
  ): Promise<DocumentWatch<T> | undefined>;
  watchDoc<T extends JsonObject, I extends JsonValue>(
    token: ConversationDocFamilyToken<T, I>,
    conversationId: ConversationId,
    key: string,
    context: Context,
  ): Promise<DocumentWatch<T> | undefined>;
  watchDoc<T extends JsonObject, I extends JsonValue>(
    token: TaskDocFamilyToken<T, I>,
    taskId: TaskId,
    key: string,
    context: Context,
  ): Promise<DocumentWatch<T> | undefined>;
  async watchDoc(
    token: AnyDocToken,
    ...args: readonly unknown[]
  ): Promise<DocumentWatch<JsonObject> | undefined> {
    this.assertUsable();
    const definition = token.definition;
    const resolved = resolveAddress(definition, args);
    const context = args[resolved.nextArgument] as Context;
    const signal = context.abortSignal;
    let cancelled = signal?.aborted ?? false;
    const markCancelled = (): void => {
      cancelled = true;
    };
    signal?.addEventListener("abort", markCancelled, { once: true });
    try {
      const watch = await this.#enqueue(async () => {
        this.#assertHealthy();
        if (cancelled) throw cancellationError(signal!);
        const loaded = await this.#loadDocument(definition, resolved.id, resolved.address, context);
        if (cancelled) throw cancellationError(signal!);
        if (loaded === undefined) return undefined;
        return this.#attachDocument(
          definition,
          loaded,
          (value, release) =>
            new CommittedWatch<ObservedDocumentValue>(value, release, (error) =>
              this.report(error),
            ),
        ).observer;
      });
      if (watch === undefined) return undefined;
      if (cancelled) {
        watch.cancel();
        throw cancellationError(signal!);
      }
      if (signal !== undefined) watch.observeCancellation(signal);
      return watch as DocumentWatch<JsonObject>;
    } finally {
      signal?.removeEventListener("abort", markCancelled);
    }
  }

  snapshotAsOf<T extends JsonObject>(
    token: RewindableConversationDocToken<T>,
    conversationId: ConversationId,
    at: EntryId,
    context: Context,
  ): Promise<Readonly<T> | undefined>;
  snapshotAsOf<T extends JsonObject, I extends JsonValue>(
    token: RewindableConversationDocFamilyToken<T, I>,
    conversationId: ConversationId,
    key: string,
    at: EntryId,
    context: Context,
  ): Promise<Readonly<T> | undefined>;
  snapshotAsOf(token: AnyDocToken, ...args: readonly unknown[]): Promise<JsonObject | undefined> {
    return promiseTry(() => {
      this.assertUsable();
      const definition = token.definition;
      const resolved = resolveAddress(definition, args);
      if (resolved.address.scope.kind !== "conversation") {
        throw new TypeError("Session.snapshotAsOf() requires a conversation document");
      }
      const conversationId = resolved.address.scope.conversationId;
      const atValue = args[resolved.nextArgument];
      if (typeof atValue !== "number" || !Number.isSafeInteger(atValue)) {
        throw new TypeError("Session.snapshotAsOf() requires an entry ID");
      }
      const at = idFromNumber<EntryId>(atValue);
      const context = args[resolved.nextArgument + 1] as Context;
      return this.#enqueue(async () => {
        this.#assertHealthy();
        const storedEntry = await this.#storage.entry(conversationId, at, context);
        if (storedEntry === undefined) {
          throw new Error(`Entry ${at} is not visible from conversation ${conversationId}`);
        }
        const address: DocumentAddress = {
          ...resolved.address,
          scope: { kind: "conversation", conversationId: storedEntry.entry.conversationId },
        };
        const record = await this.#storage.findDocument(address, storedEntry.commitSeq, context);
        if (record === undefined) return undefined;
        const stored = await this.#storage.document(record.id, storedEntry.commitSeq, context);
        if (stored === undefined) {
          throw new Error(`Historical document ${record.id} (${record.kind}) cannot be read`);
        }
        return materializeDocument(definition, stored);
      });
    });
  }

  close(context: Context): Promise<void> {
    if (this.#closing === undefined) {
      const cleanup = withoutAbortSignal(context);
      this.#closing = Promise.resolve()
        .then(() => this.beforeClose())
        .then(() =>
          this.#enqueue(async () => {
            this.#commitListeners.clear();
            this.#internalListeners.clear();
            this.#documents.clear();
            this.#idleDocuments.clear();
            this.#attachedDocuments.clear();
            try {
              await this.#storage.close(cleanup);
            } catch (error) {
              if (this.#failure === undefined) {
                this.#failure = { error };
                this.report(error);
              }
              throw error;
            }
          }),
        )
        .finally(() => {
          const failure = this.#failure;
          this.#closed.resolve(
            failure === undefined
              ? { reason: "closed" }
              : { reason: "failed", error: failure.error },
          );
        });
      this.#notifyClose();
    }
    return awaitWithContext(this.#closing, context);
  }

  #notifyClose(): void {
    if (this.#documentSweep?.timer !== undefined) clearTimeout(this.#documentSweep.timer);
    this.#documentSweep = undefined;
    const listeners = [...this.#closeListeners];
    this.#closeListeners.clear();
    for (const listener of listeners) contained(listener, (error) => this.report(error));
  }

  report(_error: unknown): void {}

  protected conversationCreated(_tx: Transaction, _record: ConversationRecord): Promise<void> {
    return Promise.resolve();
  }

  protected beforeClose(): Promise<void> {
    return Promise.resolve();
  }

  subscribeCommits(
    listener: (publication: CommitPublication, context: Context) => void,
  ): () => void {
    this.assertUsable();
    this.#commitListeners.add(listener);
    return () => this.#commitListeners.delete(listener);
  }

  observeCommits(listener: (publication: CommitPublication, context: Context) => void): () => void {
    this.assertUsable();
    this.#internalListeners.add(listener);
    return () => this.#internalListeners.delete(listener);
  }

  subscribeClose(listener: () => void): () => void {
    this.assertUsable();
    this.#closeListeners.add(listener);
    return () => this.#closeListeners.delete(listener);
  }

  unloadDocuments(): Promise<void> {
    return this.#enqueue(() =>
      promiseTry(() => {
        this.#documents.clear();
        this.#idleDocuments.clear();
      }),
    );
  }

  get documentCacheSizes(): {
    readonly cached: number;
    readonly idle: number;
    readonly attached: number;
    readonly sweeps: number;
  } {
    return {
      cached: this.#documents.size,
      idle: this.#idleDocuments.size,
      attached: this.#attachedDocuments.size,
      sweeps: this.#sweepJobs,
    };
  }

  #touchDocument(addressId: string): void {
    const cached = this.#documents.get(addressId);
    if (cached === undefined || this.#attachedDocuments.has(cached.record.id)) return;
    const now = this.#clock();
    const since = this.#idleDocuments.get(addressId);
    if (since !== undefined && now - since < Math.min(1_000, this.#documentRetentionMs() / 10))
      return;
    this.#idleDocuments.delete(addressId);
    this.#idleDocuments.set(addressId, now);
    if (
      this.#documentSweep === undefined ||
      this.#documentSweep.at > now + this.#documentRetentionMs()
    ) {
      this.#scheduleDocumentSweep();
    }
  }

  #dropDocument(addressId: string): void {
    this.#documents.delete(addressId);
    this.#idleDocuments.delete(addressId);
  }

  #scheduleDocumentSweep(): void {
    if (this.#closing !== undefined) return;
    const oldest = this.#idleDocuments.values().next();
    if (oldest.done === true) return;
    const at = oldest.value + this.#documentRetentionMs();
    if (this.#documentSweep !== undefined && this.#documentSweep.at <= at) return;
    if (this.#documentSweep?.timer !== undefined) clearTimeout(this.#documentSweep.timer);
    const sweep = { at, timer: undefined as ReturnType<typeof setTimeout> | undefined };
    const run = (): void => {
      this.#sweepJobs++;
      this.#enqueue(() =>
        promiseTry(() => {
          if (this.#documentSweep === sweep) this.#documentSweep = undefined;
          if (this.#closing === undefined) this.#sweepDocuments();
        }),
      ).catch(() => {});
    };
    const delay = at - this.#clock();
    this.#documentSweep = sweep;
    if (delay <= 0) {
      queueMicrotask(run);
      return;
    }
    if (this.#documentTimersUnavailable) {
      this.#documentSweep = undefined;
      return;
    }
    const timer = setTimeout(run, Math.min(delay, MAX_TIMER_DELAY));
    const unref = (timer as { unref?: unknown }).unref;
    if (typeof unref !== "function") {
      clearTimeout(timer);
      this.#documentTimersUnavailable = true;
      this.#documentSweep = undefined;
      return;
    }
    unref.call(timer);
    sweep.timer = timer;
  }

  #sweepDocuments(): void {
    const expired = this.#clock() - this.#documentRetentionMs();
    for (const [addressId, since] of this.#idleDocuments) {
      if (since > expired) break;
      this.#dropDocument(addressId);
    }
    this.#scheduleDocumentSweep();
  }

  #pinDocument(addressId: string, recordId: DocumentId): () => void {
    this.#attachedDocuments.set(recordId, (this.#attachedDocuments.get(recordId) ?? 0) + 1);
    this.#idleDocuments.delete(addressId);
    let pinned = true;
    return () => {
      if (!pinned) return;
      pinned = false;
      const count = (this.#attachedDocuments.get(recordId) ?? 1) - 1;
      if (count > 0) {
        this.#attachedDocuments.set(recordId, count);
        return;
      }
      this.#attachedDocuments.delete(recordId);
      if (this.#documents.get(addressId)?.record.id === recordId) this.#touchDocument(addressId);
    };
  }

  async #runCommit<T>(
    change: (tx: Transaction) => T | Promise<T>,
    context: Context,
    scope?: TransactionScope,
  ): Promise<T> {
    this.#assertHealthy();
    context.abortSignal?.throwIfAborted();
    const tx = new Transaction(this.#host, context, scope);
    let result: T;
    try {
      result = await change(tx);
      this.#assertHealthy();
    } catch (error) {
      await tx.settleFailure();
      this.#sweepDocuments();
      throw error;
    }
    let writes: readonly StorageWrite[];
    try {
      writes = await tx.settleSuccess();
    } catch (error) {
      this.#sweepDocuments();
      throw error;
    }
    if (writes.length === 0) {
      tx.discard();
      this.#sweepDocuments();
      return result;
    }
    let seq: Seq;
    try {
      seq = await this.#storage.commit(writes, withoutAbortSignal(context));
    } catch (error) {
      tx.discard();
      throw error;
    }
    let documents: DocumentCommitChange[];
    try {
      documents = tx.adopt(seq);
    } catch (error) {
      this.fail(error);
      throw error;
    }
    for (const document of documents) this.#touchDocument(documentAddressId(document.record));
    this.#publish(seq, writes, documents, context);
    this.#sweepDocuments();
    return result;
  }

  #publish(
    seq: Seq,
    writes: readonly StorageWrite[],
    documents: readonly DocumentCommitChange[],
    context: Context,
  ): void {
    if (this.#commitListeners.size === 0 && this.#internalListeners.size === 0) return;
    const changes: CommitChange[] = [];
    for (const write of writes) {
      switch (write.type) {
        case "conversation":
        case "entry":
        case "task":
        case "submission":
          changes.push(write);
      }
    }
    for (const document of documents) changes.push(document);
    const publication: CommitPublication = { seq, changes };
    for (const listener of [...this.#internalListeners]) {
      contained(
        () => listener(publication, context),
        (error) => this.fail(error),
      );
    }
    for (const listener of [...this.#commitListeners]) {
      contained(
        () => listener(publication, context),
        (error) => this.report(error),
      );
    }
  }

  #attachDocument<O extends CommittedStateSource | CommittedWatch>(
    definition: AnyDocToken["definition"],
    loaded: LoadedDocument,
    create: (value: JsonObject, detach: () => void) => O,
  ): { observer: O; detach: () => void } {
    checkRecordScope(definition, loaded.record);
    checkRecordVersion(definition, loaded.record, loaded.storedVersion);
    let unsubscribeCommit = (): void => {};
    let unsubscribeClose = (): void => {};
    const unpin = this.#pinDocument(loaded.addressId, loaded.record.id);
    const detach = (): void => {
      unsubscribeCommit();
      unsubscribeClose();
      unpin();
    };
    let observer: O;
    try {
      observer = create(loaded.tracker.value, detach);
    } catch (error) {
      unpin();
      throw error;
    }
    const observed = { version: loaded.valueVersion };
    unsubscribeCommit = this.observeCommits((publication, context) => {
      for (const change of publication.changes) {
        if (change.type !== "document" || change.record.id !== loaded.record.id) continue;
        const frameContext =
          observer instanceof CommittedStateSource ? withoutAbortSignal(context) : context;
        const ops = observedOperations(observed, change);
        if (ops.length === 0) continue;
        if (change.value === null) unpin();
        observer.advance(change.value, ops, frameContext);
      }
    });
    unsubscribeClose = this.subscribeClose(() => observer.closeSession(this.#failure));
    return { observer, detach };
  }

  async #loadDocument(
    definition: AnyDocToken["definition"],
    addressId: string,
    address: DocumentAddress,
    context: Context,
  ): Promise<LoadedDocument | undefined> {
    const cached = this.#documents.get(addressId);
    if (cached?.valueVersion === definition.version) {
      this.#touchDocument(addressId);
      return cached;
    }
    if (cached !== undefined) this.#dropDocument(addressId);
    const record = await this.#storage.findDocument(address, "current", context);
    if (record === undefined) return undefined;
    const stored = await this.#storage.document(record.id, "current", context);
    if (stored === undefined)
      throw new Error(`Current document ${record.id} (${record.kind}) cannot be read`);
    const value = materializeDocument(definition, stored);
    const loaded: LoadedDocument = {
      addressId,
      record: stored.record,
      storedVersion: stored.version,
      valueVersion: definition.version,
      deltasSinceBase: stored.deltasSinceBase,
      tracker: track(value),
    };
    this.#documents.set(addressId, loaded);
    this.#touchDocument(addressId);
    return loaded;
  }

  #enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = this.#tail.then(job);
    this.#tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  assertUsable(): void {
    this.#assertHealthy();
    if (this.#closing !== undefined) throw new Error("Session is closed");
  }

  #assertHealthy(): void {
    if (this.#failure !== undefined) throw new SessionFailed(this.#failure.error);
  }
}

export function contained(callback: () => unknown, onError: (error: unknown) => void): void {
  try {
    const result = callback();
    if (typeof (result as { then?: unknown } | null)?.then === "function")
      Promise.resolve(result).catch(onError);
  } catch (error) {
    onError(error);
  }
}

function observedOperations(
  observed: { version: number },
  change: Extract<DocumentCommitChange, { readonly type: "document" }>,
): readonly Op[] {
  if (change.value === null) return RETIREMENT_OPERATIONS;
  if (change.version === observed.version) return change.ops;
  observed.version = change.version!;
  return [["r", change.value]];
}

function cancellationError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("The operation was aborted", "AbortError");
}

type FailureLatch = {
  readonly failure: { readonly error: unknown } | undefined;
  fail(error: unknown): void;
};

class GuardedStorage implements Storage {
  readonly #storage: Storage;
  readonly #latch: FailureLatch;
  readonly #underway = new Set<Promise<unknown>>();
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

  entry(
    id: EntryId,
    context: Context,
  ): Promise<{ readonly entry: EntryRecord; readonly commitSeq: Seq } | undefined>;
  entry(
    conversationId: ConversationId,
    id: EntryId,
    context: Context,
  ): Promise<{ readonly entry: EntryRecord; readonly commitSeq: Seq } | undefined>;
  entry(
    first: EntryId | ConversationId,
    second: EntryId | Context,
    third?: Context,
  ): Promise<{ readonly entry: EntryRecord; readonly commitSeq: Seq } | undefined> {
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

  task(
    id: TaskId,
    context: Context,
  ): Promise<TaskRecord<JsonValue, JsonValue, JsonValue> | undefined> {
    return this.#call(context, () => this.#storage.task(id, context));
  }

  scanTasks(
    query: TaskQuery,
    limit: number,
    cursor: Cursor | undefined,
    context: Context,
  ): Promise<Page<TaskRecord<JsonValue, JsonValue, JsonValue>, Cursor>> {
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

  async close(context: Context): Promise<void> {
    this.#closing = true;
    await Promise.allSettled([...this.#underway]);
    return this.#storage.close(context);
  }

  async #call<T>(read: Context | undefined, run: () => Promise<T>): Promise<T> {
    this.#assertHealthy();
    if (this.#closing) throw new Error("Session is closed");
    let result: T;
    const call = (() => promiseTry(() => run()))();
    this.#underway.add(call);
    try {
      result = await call;
    } catch (error) {
      this.#assertHealthy();
      const exempt =
        read !== undefined &&
        (error instanceof StorageRequestError || read.abortSignal?.aborted === true);
      if (!exempt) this.#latch.fail(error);
      throw error;
    } finally {
      this.#underway.delete(call);
    }
    this.#assertHealthy();
    return result;
  }

  #assertHealthy(): void {
    const failure = this.#latch.failure;
    if (failure !== undefined) throw new SessionFailed(failure.error);
  }
}
