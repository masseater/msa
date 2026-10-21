import type deltaTypes from "@msa/chord/delta.types";
import type chordTypes from "@msa/chord/index.types";

import type documentsTypes from "./documents.types.ts";
import type idsTypes from "./ids.types.ts";
import type recordsTypes from "./records.ts";
import type storageTypes from "./storage.ts";
import type tasksTypes from "./tasks.ts";

declare namespace sessionTypes {
  interface Tx {
    conversation(id: idsTypes.ConversationId): Promise<recordsTypes.ConversationRecord | undefined>;
    entry(id: idsTypes.EntryId): Promise<recordsTypes.EntryRecord | undefined>;
    entry<D extends chordTypes.JsonValue>(
      token: recordsTypes.Entry<D>,
      id: idsTypes.EntryId,
    ): Promise<recordsTypes.TypedEntry<D> | undefined>;
    task(
      id: idsTypes.TaskId,
    ): Promise<
      | tasksTypes.TaskRecord<chordTypes.JsonValue, chordTypes.JsonValue, chordTypes.JsonValue>
      | undefined
    >;
    scanConversations(
      query: storageTypes.ConversationQuery,
      limit: number,
      cursor?: storageTypes.Cursor,
    ): Promise<storageTypes.Page<recordsTypes.ConversationRecord, storageTypes.Cursor>>;
    scanEntries(
      query: storageTypes.EntryQuery,
      limit: number,
      cursor?: storageTypes.Cursor,
    ): Promise<storageTypes.Page<recordsTypes.EntryRecord, storageTypes.Cursor>>;
    latestHeadMarker(
      conversationId: idsTypes.ConversationId,
    ): Promise<(recordsTypes.EntryRecord & { readonly head: idsTypes.EntryId }) | undefined>;
    scanTasks(
      query: storageTypes.TaskQuery,
      limit: number,
      cursor?: storageTypes.Cursor,
    ): Promise<
      storageTypes.Page<
        tasksTypes.TaskRecord<chordTypes.JsonValue, chordTypes.JsonValue, chordTypes.JsonValue>,
        storageTypes.Cursor
      >
    >;
    submissionByRequest(
      conversationId: idsTypes.ConversationId,
      requestId: string,
    ): Promise<recordsTypes.SubmissionRecord | undefined>;

    createConversation(options: {
      readonly ownership: recordsTypes.ConversationOwnership;
    }): Promise<recordsTypes.ConversationRecord>;
    forkConversation(
      parentConversationId: idsTypes.ConversationId,
      at: idsTypes.EntryId,
      options: { readonly ownership: recordsTypes.ConversationOwnership },
    ): Promise<recordsTypes.ConversationRecord>;
    appendEntry(
      conversationId: idsTypes.ConversationId,
      value: recordsTypes.EntryDraft,
    ): Promise<recordsTypes.EntryRecord>;
    appendEntry<D extends chordTypes.JsonValue>(
      token: recordsTypes.Entry<D>,
      conversationId: idsTypes.ConversationId,
      value: recordsTypes.TypedEntryDraft<NoInfer<D>>,
    ): Promise<recordsTypes.TypedEntry<D>>;
    createTask<I, S extends { phase: string }, R, H extends object>(
      task: tasksTypes.Task<I, S, R, H>,
      input: I,
      options: tasksTypes.TaskOptions,
    ): Promise<idsTypes.TaskId<R>>;
    createSubmission(create: recordsTypes.SubmissionCreate): Promise<recordsTypes.SubmissionRecord>;
    settleSubmission(
      id: idsTypes.SubmissionId,
      settlement: recordsTypes.SubmissionSettlement,
    ): void;
    placeSubmission(id: idsTypes.SubmissionId, entry: idsTypes.EntryId): void;

    doc<T extends idsTypes.JsonObject>(
      token: documentsTypes.SessionDocToken<T>,
    ): Promise<chordTypes.Draft<T>>;
    doc<T extends idsTypes.JsonObject>(
      token: documentsTypes.ConversationDocToken<T>,
      conversationId: idsTypes.ConversationId,
    ): Promise<chordTypes.Draft<T>>;
    doc<T extends idsTypes.JsonObject>(
      token: documentsTypes.TaskDocToken<T>,
      taskId: idsTypes.TaskId,
    ): Promise<chordTypes.Draft<T>>;
    doc<T extends idsTypes.JsonObject, I extends chordTypes.JsonValue>(
      token: documentsTypes.SessionDocFamilyToken<T, I>,
      key: string,
      seed: I,
    ): Promise<chordTypes.Draft<T>>;
    doc<T extends idsTypes.JsonObject, I extends chordTypes.JsonValue>(
      token: documentsTypes.ConversationDocFamilyToken<T, I>,
      conversationId: idsTypes.ConversationId,
      key: string,
      seed: I,
    ): Promise<chordTypes.Draft<T>>;
    doc<T extends idsTypes.JsonObject, I extends chordTypes.JsonValue>(
      token: documentsTypes.TaskDocFamilyToken<T, I>,
      taskId: idsTypes.TaskId,
      key: string,
      seed: I,
    ): Promise<chordTypes.Draft<T>>;

    retireDoc<T extends idsTypes.JsonObject>(
      token: documentsTypes.SessionDocToken<T>,
    ): Promise<void>;
    retireDoc<T extends idsTypes.JsonObject>(
      token: documentsTypes.ConversationDocToken<T>,
      conversationId: idsTypes.ConversationId,
    ): Promise<void>;
    retireDoc<T extends idsTypes.JsonObject>(
      token: documentsTypes.TaskDocToken<T>,
      taskId: idsTypes.TaskId,
    ): Promise<void>;
    retireDoc<T extends idsTypes.JsonObject, I extends chordTypes.JsonValue>(
      token: documentsTypes.SessionDocFamilyToken<T, I>,
      key: string,
    ): Promise<void>;
    retireDoc<T extends idsTypes.JsonObject, I extends chordTypes.JsonValue>(
      token: documentsTypes.ConversationDocFamilyToken<T, I>,
      conversationId: idsTypes.ConversationId,
      key: string,
    ): Promise<void>;
    retireDoc<T extends idsTypes.JsonObject, I extends chordTypes.JsonValue>(
      token: documentsTypes.TaskDocFamilyToken<T, I>,
      taskId: idsTypes.TaskId,
      key: string,
    ): Promise<void>;
  }

  type DocumentState<T extends idsTypes.JsonObject> =
    chordTypes.AttachedReplicatedState<Readonly<T> | null>;

  type WatchEnd =
    | { readonly reason: "stopped" | "cancelled" | "session_closed" | "retired" }
    | { readonly reason: "listener_error"; readonly error: Error }
    | { readonly reason: "session_failed"; readonly error: unknown };

  interface WatchHandle<T> {
    readonly value: T;
    start(
      listener: (
        value: T,
        ops: readonly deltaTypes.Op[],
        context: chordTypes.Context,
      ) => Promise<void>,
    ): void;
    stop(): Promise<WatchEnd>;
    readonly closed: Promise<WatchEnd>;
  }

  type DocumentWatch<T extends idsTypes.JsonObject> = WatchHandle<Readonly<T> | null>;

  type DocumentReader = Pick<Session, "snapshot" | "snapshotAsOf">;

  interface DocumentObserver {
    watchDoc<T extends idsTypes.JsonObject>(
      token: documentsTypes.SessionDocToken<T>,
      context: chordTypes.Context,
    ): Promise<DocumentWatch<T> | undefined>;
    watchDoc<T extends idsTypes.JsonObject>(
      token: documentsTypes.ConversationDocToken<T>,
      conversationId: idsTypes.ConversationId,
      context: chordTypes.Context,
    ): Promise<DocumentWatch<T> | undefined>;
    watchDoc<T extends idsTypes.JsonObject>(
      token: documentsTypes.TaskDocToken<T>,
      taskId: idsTypes.TaskId,
      context: chordTypes.Context,
    ): Promise<DocumentWatch<T> | undefined>;
    watchDoc<T extends idsTypes.JsonObject, I extends chordTypes.JsonValue>(
      token: documentsTypes.SessionDocFamilyToken<T, I>,
      key: string,
      context: chordTypes.Context,
    ): Promise<DocumentWatch<T> | undefined>;
    watchDoc<T extends idsTypes.JsonObject, I extends chordTypes.JsonValue>(
      token: documentsTypes.ConversationDocFamilyToken<T, I>,
      conversationId: idsTypes.ConversationId,
      key: string,
      context: chordTypes.Context,
    ): Promise<DocumentWatch<T> | undefined>;
    watchDoc<T extends idsTypes.JsonObject, I extends chordTypes.JsonValue>(
      token: documentsTypes.TaskDocFamilyToken<T, I>,
      taskId: idsTypes.TaskId,
      key: string,
      context: chordTypes.Context,
    ): Promise<DocumentWatch<T> | undefined>;
  }

  type SessionEnd =
    | { readonly reason: "closed" }
    | { readonly reason: "failed"; readonly error: unknown };

  interface Session extends DocumentObserver {
    commit<T>(change: (tx: Tx) => T | Promise<T>, context: chordTypes.Context): Promise<T>;
    close(context: chordTypes.Context): Promise<void>;
    readonly closed: Promise<SessionEnd>;
    subscribeCommits(
      listener: (publication: storageTypes.CommitPublication, context: chordTypes.Context) => void,
    ): () => void;
    subscribeClose(listener: () => void): () => void;

    snapshot<T extends idsTypes.JsonObject>(
      token: documentsTypes.SessionDocToken<T>,
      context: chordTypes.Context,
    ): Promise<Readonly<T> | undefined>;
    snapshot<T extends idsTypes.JsonObject>(
      token: documentsTypes.ConversationDocToken<T>,
      conversationId: idsTypes.ConversationId,
      context: chordTypes.Context,
    ): Promise<Readonly<T> | undefined>;
    snapshot<T extends idsTypes.JsonObject>(
      token: documentsTypes.TaskDocToken<T>,
      taskId: idsTypes.TaskId,
      context: chordTypes.Context,
    ): Promise<Readonly<T> | undefined>;
    snapshot<T extends idsTypes.JsonObject, I extends chordTypes.JsonValue>(
      token: documentsTypes.SessionDocFamilyToken<T, I>,
      key: string,
      context: chordTypes.Context,
    ): Promise<Readonly<T> | undefined>;
    snapshot<T extends idsTypes.JsonObject, I extends chordTypes.JsonValue>(
      token: documentsTypes.ConversationDocFamilyToken<T, I>,
      conversationId: idsTypes.ConversationId,
      key: string,
      context: chordTypes.Context,
    ): Promise<Readonly<T> | undefined>;
    snapshot<T extends idsTypes.JsonObject, I extends chordTypes.JsonValue>(
      token: documentsTypes.TaskDocFamilyToken<T, I>,
      taskId: idsTypes.TaskId,
      key: string,
      context: chordTypes.Context,
    ): Promise<Readonly<T> | undefined>;

    documentState<T extends idsTypes.JsonObject>(
      token: documentsTypes.SessionDocToken<T>,
      context: chordTypes.Context,
    ): Promise<DocumentState<T> | undefined>;
    documentState<T extends idsTypes.JsonObject>(
      token: documentsTypes.ConversationDocToken<T>,
      conversationId: idsTypes.ConversationId,
      context: chordTypes.Context,
    ): Promise<DocumentState<T> | undefined>;
    documentState<T extends idsTypes.JsonObject>(
      token: documentsTypes.TaskDocToken<T>,
      taskId: idsTypes.TaskId,
      context: chordTypes.Context,
    ): Promise<DocumentState<T> | undefined>;
    documentState<T extends idsTypes.JsonObject, I extends chordTypes.JsonValue>(
      token: documentsTypes.SessionDocFamilyToken<T, I>,
      key: string,
      context: chordTypes.Context,
    ): Promise<DocumentState<T> | undefined>;
    documentState<T extends idsTypes.JsonObject, I extends chordTypes.JsonValue>(
      token: documentsTypes.ConversationDocFamilyToken<T, I>,
      conversationId: idsTypes.ConversationId,
      key: string,
      context: chordTypes.Context,
    ): Promise<DocumentState<T> | undefined>;
    documentState<T extends idsTypes.JsonObject, I extends chordTypes.JsonValue>(
      token: documentsTypes.TaskDocFamilyToken<T, I>,
      taskId: idsTypes.TaskId,
      key: string,
      context: chordTypes.Context,
    ): Promise<DocumentState<T> | undefined>;

    snapshotAsOf<T extends idsTypes.JsonObject>(
      token: documentsTypes.RewindableConversationDocToken<T>,
      conversationId: idsTypes.ConversationId,
      at: idsTypes.EntryId,
      context: chordTypes.Context,
    ): Promise<Readonly<T> | undefined>;
    snapshotAsOf<T extends idsTypes.JsonObject, I extends chordTypes.JsonValue>(
      token: documentsTypes.RewindableConversationDocFamilyToken<T, I>,
      conversationId: idsTypes.ConversationId,
      key: string,
      at: idsTypes.EntryId,
      context: chordTypes.Context,
    ): Promise<Readonly<T> | undefined>;
  }
}

export type { sessionTypes as default };
