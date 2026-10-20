import type chordTypes from "@msa/chord/index.types";
import { Effect } from "effect";

import type typesModule from "../types.types.ts";
import GuardedStorage from "./guarded-storage.ts";
import sessionClose from "./session-close.ts";
import sessionCommit from "./session-commit.ts";
import sessionObserve from "./session-observe.ts";
import sessionReads from "./session-reads.ts";
import sessionState from "./session-state.ts";
import type sessionTypes from "./session.types.ts";

const {
  addListener,
  assertUsable,
  createSessionState,
  currentTimeMillis,
  documentCacheSizes,
  readOnLine,
  unloadDocuments,
} = sessionState;

const { commitOnLine, createTransactionHost } = sessionCommit;
const { closeSession, failSession } = sessionClose;
const { conversationDocumentOnLine, snapshotAsOf, snapshotDocument } = sessionReads;
const { documentStateOf, watchDocument } = sessionObserve;

type DocumentOnLine =
  | {
      readonly record: typesModule.DocumentRecord;
      readonly version: number;
      readonly value: typesModule.JsonObject;
    }
  | undefined;

export default class SessionImpl implements typesModule.Session {
  readonly #state: sessionTypes.SessionState;
  readonly #host: sessionTypes.TransactionHost;

  get closed(): Promise<typesModule.SessionEnd> {
    return this.#state.closed.promise;
  }

  get failure(): { readonly error: unknown } | undefined {
    return this.#state.failure;
  }

  get failed(): Promise<never> {
    return this.#state.failed.promise;
  }

  constructor(
    storage: typesModule.Storage,
    now: () => number = currentTimeMillis,
    documentRetentionMs: () => number | undefined = () => undefined,
  ) {
    const hooks = {
      beforeClose: () => this.beforeClose(),
      conversationCreated: (tx: sessionTypes.Transaction, record: typesModule.ConversationRecord) =>
        this.conversationCreated(tx, record),
      fail: (error: unknown) => this.fail(error),
      report: (error: unknown) => this.report(error),
    };
    const guarded = new GuardedStorage(storage, this);
    this.#state = createSessionState({ documentRetentionMs, hooks, now, storage: guarded });
    this.#state.failed.promise.catch(() => {});
    this.#host = createTransactionHost(this.#state);
  }

  protected get storage(): typesModule.Storage {
    return this.#state.storage;
  }

  commit<T>(
    change: (tx: typesModule.Tx) => T | Promise<T>,
    context: chordTypes.Context,
  ): Promise<T> {
    return this.commitWith(change, context);
  }

  fail(error: unknown): void {
    failSession(this.#state, error);
  }

  commitWith<T>(
    change: (tx: sessionTypes.Transaction) => T | Promise<T>,
    context: chordTypes.Context,
    scope?: sessionTypes.TransactionScope,
  ): Promise<T> {
    return commitOnLine(this.#state, this.#host, change, context, scope);
  }

  readOnLine<T>(job: () => Promise<T>): Promise<T> {
    return readOnLine(this.#state, job);
  }

  conversationDocumentOnLine(
    token: typesModule.ConversationDocToken<typesModule.JsonObject>,
    conversationId: typesModule.ConversationId,
    context: chordTypes.Context,
  ): Promise<DocumentOnLine> {
    const args = [conversationId, context] as const;
    return Effect.runPromise(conversationDocumentOnLine(this.#state, token, args));
  }

  snapshot<T extends typesModule.JsonObject>(
    token: typesModule.SessionDocToken<T>,
    context: chordTypes.Context,
  ): Promise<Readonly<T> | undefined>;
  snapshot<T extends typesModule.JsonObject>(
    token: typesModule.ConversationDocToken<T>,
    conversationId: typesModule.ConversationId,
    context: chordTypes.Context,
  ): Promise<Readonly<T> | undefined>;
  snapshot<T extends typesModule.JsonObject>(
    token: typesModule.TaskDocToken<T>,
    taskId: typesModule.TaskId,
    context: chordTypes.Context,
  ): Promise<Readonly<T> | undefined>;
  snapshot<T extends typesModule.JsonObject, I extends chordTypes.JsonValue>(
    token: typesModule.SessionDocFamilyToken<T, I>,
    key: string,
    context: chordTypes.Context,
  ): Promise<Readonly<T> | undefined>;
  snapshot<T extends typesModule.JsonObject, I extends chordTypes.JsonValue>(
    token: typesModule.ConversationDocFamilyToken<T, I>,
    conversationId: typesModule.ConversationId,
    key: string,
    context: chordTypes.Context,
  ): Promise<Readonly<T> | undefined>;
  snapshot<T extends typesModule.JsonObject, I extends chordTypes.JsonValue>(
    token: typesModule.TaskDocFamilyToken<T, I>,
    taskId: typesModule.TaskId,
    key: string,
    context: chordTypes.Context,
  ): Promise<Readonly<T> | undefined>;
  snapshot(
    token: sessionTypes.AnyDocToken,
    ...args: readonly unknown[]
  ): Promise<typesModule.JsonObject | undefined> {
    return Effect.runPromise(snapshotDocument(this.#state, token, args));
  }

  documentState<T extends typesModule.JsonObject>(
    token: typesModule.SessionDocToken<T>,
    context: chordTypes.Context,
  ): Promise<typesModule.DocumentState<T> | undefined>;
  documentState<T extends typesModule.JsonObject>(
    token: typesModule.ConversationDocToken<T>,
    conversationId: typesModule.ConversationId,
    context: chordTypes.Context,
  ): Promise<typesModule.DocumentState<T> | undefined>;
  documentState<T extends typesModule.JsonObject>(
    token: typesModule.TaskDocToken<T>,
    taskId: typesModule.TaskId,
    context: chordTypes.Context,
  ): Promise<typesModule.DocumentState<T> | undefined>;
  documentState<T extends typesModule.JsonObject, I extends chordTypes.JsonValue>(
    token: typesModule.SessionDocFamilyToken<T, I>,
    key: string,
    context: chordTypes.Context,
  ): Promise<typesModule.DocumentState<T> | undefined>;
  documentState<T extends typesModule.JsonObject, I extends chordTypes.JsonValue>(
    token: typesModule.ConversationDocFamilyToken<T, I>,
    conversationId: typesModule.ConversationId,
    key: string,
    context: chordTypes.Context,
  ): Promise<typesModule.DocumentState<T> | undefined>;
  documentState<T extends typesModule.JsonObject, I extends chordTypes.JsonValue>(
    token: typesModule.TaskDocFamilyToken<T, I>,
    taskId: typesModule.TaskId,
    key: string,
    context: chordTypes.Context,
  ): Promise<typesModule.DocumentState<T> | undefined>;
  documentState(
    token: sessionTypes.AnyDocToken,
    ...args: readonly unknown[]
  ): Promise<typesModule.DocumentState<typesModule.JsonObject> | undefined> {
    return documentStateOf(this.#state, token, args);
  }

  watchDoc<T extends typesModule.JsonObject>(
    token: typesModule.SessionDocToken<T>,
    context: chordTypes.Context,
  ): Promise<typesModule.DocumentWatch<T> | undefined>;
  watchDoc<T extends typesModule.JsonObject>(
    token: typesModule.ConversationDocToken<T>,
    conversationId: typesModule.ConversationId,
    context: chordTypes.Context,
  ): Promise<typesModule.DocumentWatch<T> | undefined>;
  watchDoc<T extends typesModule.JsonObject>(
    token: typesModule.TaskDocToken<T>,
    taskId: typesModule.TaskId,
    context: chordTypes.Context,
  ): Promise<typesModule.DocumentWatch<T> | undefined>;
  watchDoc<T extends typesModule.JsonObject, I extends chordTypes.JsonValue>(
    token: typesModule.SessionDocFamilyToken<T, I>,
    key: string,
    context: chordTypes.Context,
  ): Promise<typesModule.DocumentWatch<T> | undefined>;
  watchDoc<T extends typesModule.JsonObject, I extends chordTypes.JsonValue>(
    token: typesModule.ConversationDocFamilyToken<T, I>,
    conversationId: typesModule.ConversationId,
    key: string,
    context: chordTypes.Context,
  ): Promise<typesModule.DocumentWatch<T> | undefined>;
  watchDoc<T extends typesModule.JsonObject, I extends chordTypes.JsonValue>(
    token: typesModule.TaskDocFamilyToken<T, I>,
    taskId: typesModule.TaskId,
    key: string,
    context: chordTypes.Context,
  ): Promise<typesModule.DocumentWatch<T> | undefined>;
  watchDoc(
    token: sessionTypes.AnyDocToken,
    ...args: readonly unknown[]
  ): Promise<typesModule.DocumentWatch<typesModule.JsonObject> | undefined> {
    return Effect.runPromise(watchDocument(this.#state, token, args));
  }

  snapshotAsOf<T extends typesModule.JsonObject>(
    token: typesModule.RewindableConversationDocToken<T>,
    conversationId: typesModule.ConversationId,
    at: typesModule.EntryId,
    context: chordTypes.Context,
  ): Promise<Readonly<T> | undefined>;
  snapshotAsOf<T extends typesModule.JsonObject, I extends chordTypes.JsonValue>(
    token: typesModule.RewindableConversationDocFamilyToken<T, I>,
    conversationId: typesModule.ConversationId,
    key: string,
    at: typesModule.EntryId,
    context: chordTypes.Context,
  ): Promise<Readonly<T> | undefined>;
  snapshotAsOf(
    token: sessionTypes.AnyDocToken,
    ...args: readonly unknown[]
  ): Promise<typesModule.JsonObject | undefined> {
    return Effect.runPromise(snapshotAsOf(this.#state, token, args));
  }

  close(context: chordTypes.Context): Promise<void> {
    return closeSession(this.#state, context);
  }

  report(_error: unknown): void {}

  protected conversationCreated(
    _tx: sessionTypes.Transaction,
    _record: typesModule.ConversationRecord,
  ): Promise<void> {
    return Promise.resolve();
  }

  protected beforeClose(): Promise<void> {
    return Promise.resolve();
  }

  subscribeCommits(
    listener: (publication: typesModule.CommitPublication, context: chordTypes.Context) => void,
  ): () => void {
    assertUsable(this.#state);
    return addListener(this.#state.commitListeners, listener);
  }

  observeCommits(
    listener: (publication: typesModule.CommitPublication, context: chordTypes.Context) => void,
  ): () => void {
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

  get documentCacheSizes(): sessionTypes.DocumentCacheSizes {
    return documentCacheSizes(this.#state);
  }

  assertUsable(): void {
    assertUsable(this.#state);
  }
}
