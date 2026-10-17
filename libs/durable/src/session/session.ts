import type { Context, JsonValue } from "@msa/chord";
import { Effect } from "effect";

import type {
  CommitPublication,
  ConversationDocFamilyToken,
  ConversationDocToken,
  ConversationId,
  ConversationRecord,
  DocumentRecord,
  DocumentState,
  DocumentWatch,
  EntryId,
  JsonObject,
  RewindableConversationDocFamilyToken,
  RewindableConversationDocToken,
  Session,
  SessionDocFamilyToken,
  SessionDocToken,
  SessionEnd,
  Storage,
  TaskDocFamilyToken,
  TaskDocToken,
  TaskId,
  Tx,
} from "../types.ts";
import { GuardedStorage } from "./guarded-storage.ts";
import { closeSession, failSession } from "./session-close.ts";
import { commitOnLine, createTransactionHost } from "./session-commit.ts";
import { documentStateOf, watchDocument } from "./session-observe.ts";
import {
  type AnyDocToken,
  conversationDocumentOnLine,
  snapshotAsOf,
  snapshotDocument,
} from "./session-reads.ts";
import {
  addListener,
  assertUsable,
  createSessionState,
  currentTimeMillis,
  type DocumentCacheSizes,
  documentCacheSizes,
  readOnLine,
  type SessionState,
  unloadDocuments,
} from "./session-state.ts";
import type { Transaction, TransactionHost, TransactionScope } from "./transaction-types.ts";

export { contained, documentRetention, setDefaultDocumentRetention } from "./session-state.ts";

type DocumentOnLine =
  | { readonly record: DocumentRecord; readonly version: number; readonly value: JsonObject }
  | undefined;

export class SessionImpl implements Session {
  readonly #state: SessionState;
  readonly #host: TransactionHost;

  get closed(): Promise<SessionEnd> {
    return this.#state.closed.promise;
  }

  get failure(): { readonly error: unknown } | undefined {
    return this.#state.failure;
  }

  get failed(): Promise<never> {
    return this.#state.failed.promise;
  }

  constructor(
    storage: Storage,
    now: () => number = currentTimeMillis,
    documentRetentionMs: () => number | undefined = () => undefined,
  ) {
    const hooks = {
      report: (error: unknown) => this.report(error),
      fail: (error: unknown) => this.fail(error),
      conversationCreated: (tx: Transaction, record: ConversationRecord) =>
        this.conversationCreated(tx, record),
      beforeClose: () => this.beforeClose(),
    };
    const guarded = new GuardedStorage(storage, this);
    this.#state = createSessionState({ hooks, storage: guarded, now, documentRetentionMs });
    this.#state.failed.promise.catch(() => {});
    this.#host = createTransactionHost(this.#state);
  }

  protected get storage(): Storage {
    return this.#state.storage;
  }

  commit<T>(change: (tx: Tx) => T | Promise<T>, context: Context): Promise<T> {
    return this.commitWith(change, context);
  }

  fail(error: unknown): void {
    failSession(this.#state, error);
  }

  commitWith<T>(
    change: (tx: Transaction) => T | Promise<T>,
    context: Context,
    scope?: TransactionScope,
  ): Promise<T> {
    return commitOnLine(this.#state, this.#host, change, context, scope);
  }

  readOnLine<T>(job: () => Promise<T>): Promise<T> {
    return readOnLine(this.#state, job);
  }

  conversationDocumentOnLine(
    token: ConversationDocToken<JsonObject>,
    conversationId: ConversationId,
    context: Context,
  ): Promise<DocumentOnLine> {
    const args = [conversationId, context] as const;
    return Effect.runPromise(conversationDocumentOnLine(this.#state, token, args));
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
  snapshot(token: AnyDocToken, ...args: readonly unknown[]): Promise<JsonObject | undefined> {
    return Effect.runPromise(snapshotDocument(this.#state, token, args));
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
    return documentStateOf(this.#state, token, args);
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
  watchDoc(
    token: AnyDocToken,
    ...args: readonly unknown[]
  ): Promise<DocumentWatch<JsonObject> | undefined> {
    return Effect.runPromise(watchDocument(this.#state, token, args));
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
    return Effect.runPromise(snapshotAsOf(this.#state, token, args));
  }

  close(context: Context): Promise<void> {
    return closeSession(this.#state, context);
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
    assertUsable(this.#state);
    return addListener(this.#state.commitListeners, listener);
  }

  observeCommits(listener: (publication: CommitPublication, context: Context) => void): () => void {
    assertUsable(this.#state);
    return addListener(this.#state.internalListeners, listener);
  }

  subscribeClose(listener: () => void): () => void {
    assertUsable(this.#state);
    return addListener(this.#state.closeListeners, listener);
  }

  unloadDocuments(): Promise<void> {
    return unloadDocuments(this.#state);
  }

  get documentCacheSizes(): DocumentCacheSizes {
    return documentCacheSizes(this.#state);
  }

  assertUsable(): void {
    assertUsable(this.#state);
  }
}
