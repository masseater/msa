import type { AttachedReplicatedState, Context, Draft, JsonValue } from "@msa/chord";
import type { Op } from "@msa/chord/delta";

import type {
  ConversationDocFamilyToken,
  ConversationDocToken,
  RewindableConversationDocFamilyToken,
  RewindableConversationDocToken,
  SessionDocFamilyToken,
  SessionDocToken,
  TaskDocFamilyToken,
  TaskDocToken,
} from "./documents.ts";
import type { ConversationId, EntryId, JsonObject, SubmissionId, TaskId } from "./ids.ts";
import type {
  ConversationOwnership,
  ConversationRecord,
  Entry,
  EntryDraft,
  EntryRecord,
  SubmissionCreate,
  SubmissionRecord,
  SubmissionSettlement,
  TypedEntry,
  TypedEntryDraft,
} from "./records.ts";
import type {
  CommitPublication,
  ConversationQuery,
  Cursor,
  EntryQuery,
  Page,
  TaskQuery,
} from "./storage.ts";
import type { Task, TaskOptions, TaskRecord } from "./tasks.ts";

export interface Tx {
  conversation(id: ConversationId): Promise<ConversationRecord | undefined>;
  entry(id: EntryId): Promise<EntryRecord | undefined>;
  entry<D extends JsonValue>(token: Entry<D>, id: EntryId): Promise<TypedEntry<D> | undefined>;
  task(id: TaskId): Promise<TaskRecord<JsonValue, JsonValue, JsonValue> | undefined>;
  scanConversations(
    query: ConversationQuery,
    limit: number,
    cursor?: Cursor,
  ): Promise<Page<ConversationRecord, Cursor>>;
  scanEntries(
    query: EntryQuery,
    limit: number,
    cursor?: Cursor,
  ): Promise<Page<EntryRecord, Cursor>>;
  latestHeadMarker(
    conversationId: ConversationId,
  ): Promise<(EntryRecord & { readonly head: EntryId }) | undefined>;
  scanTasks(
    query: TaskQuery,
    limit: number,
    cursor?: Cursor,
  ): Promise<Page<TaskRecord<JsonValue, JsonValue, JsonValue>, Cursor>>;
  submissionByRequest(
    conversationId: ConversationId,
    requestId: string,
  ): Promise<SubmissionRecord | undefined>;

  createConversation(options: {
    readonly ownership: ConversationOwnership;
  }): Promise<ConversationRecord>;
  forkConversation(
    parentConversationId: ConversationId,
    at: EntryId,
    options: { readonly ownership: ConversationOwnership },
  ): Promise<ConversationRecord>;
  appendEntry(conversationId: ConversationId, value: EntryDraft): Promise<EntryRecord>;
  appendEntry<D extends JsonValue>(
    token: Entry<D>,
    conversationId: ConversationId,
    value: TypedEntryDraft<NoInfer<D>>,
  ): Promise<TypedEntry<D>>;
  createTask<I, S extends { phase: string }, R, H extends object>(
    task: Task<I, S, R, H>,
    input: I,
    options: TaskOptions,
  ): Promise<TaskId<R>>;
  createSubmission(create: SubmissionCreate): Promise<SubmissionRecord>;
  settleSubmission(id: SubmissionId, settlement: SubmissionSettlement): void;
  placeSubmission(id: SubmissionId, entry: EntryId): void;

  doc<T extends JsonObject>(token: SessionDocToken<T>): Promise<Draft<T>>;
  doc<T extends JsonObject>(
    token: ConversationDocToken<T>,
    conversationId: ConversationId,
  ): Promise<Draft<T>>;
  doc<T extends JsonObject>(token: TaskDocToken<T>, taskId: TaskId): Promise<Draft<T>>;
  doc<T extends JsonObject, I extends JsonValue>(
    token: SessionDocFamilyToken<T, I>,
    key: string,
    seed: I,
  ): Promise<Draft<T>>;
  doc<T extends JsonObject, I extends JsonValue>(
    token: ConversationDocFamilyToken<T, I>,
    conversationId: ConversationId,
    key: string,
    seed: I,
  ): Promise<Draft<T>>;
  doc<T extends JsonObject, I extends JsonValue>(
    token: TaskDocFamilyToken<T, I>,
    taskId: TaskId,
    key: string,
    seed: I,
  ): Promise<Draft<T>>;

  retireDoc<T extends JsonObject>(token: SessionDocToken<T>): Promise<void>;
  retireDoc<T extends JsonObject>(
    token: ConversationDocToken<T>,
    conversationId: ConversationId,
  ): Promise<void>;
  retireDoc<T extends JsonObject>(token: TaskDocToken<T>, taskId: TaskId): Promise<void>;
  retireDoc<T extends JsonObject, I extends JsonValue>(
    token: SessionDocFamilyToken<T, I>,
    key: string,
  ): Promise<void>;
  retireDoc<T extends JsonObject, I extends JsonValue>(
    token: ConversationDocFamilyToken<T, I>,
    conversationId: ConversationId,
    key: string,
  ): Promise<void>;
  retireDoc<T extends JsonObject, I extends JsonValue>(
    token: TaskDocFamilyToken<T, I>,
    taskId: TaskId,
    key: string,
  ): Promise<void>;
}

export type DocumentState<T extends JsonObject> = AttachedReplicatedState<Readonly<T> | null>;

export type WatchEnd =
  | { readonly reason: "stopped" | "cancelled" | "session_closed" | "retired" }
  | { readonly reason: "listener_error"; readonly error: Error }
  | { readonly reason: "session_failed"; readonly error: unknown };

export interface WatchHandle<T> {
  readonly value: T;
  start(listener: (value: T, ops: readonly Op[], context: Context) => Promise<void>): void;
  stop(): Promise<WatchEnd>;
  readonly closed: Promise<WatchEnd>;
}

export type DocumentWatch<T extends JsonObject> = WatchHandle<Readonly<T> | null>;

export type DocumentReader = Pick<Session, "snapshot" | "snapshotAsOf">;

export interface DocumentObserver {
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
}

export type SessionEnd =
  | { readonly reason: "closed" }
  | { readonly reason: "failed"; readonly error: unknown };

export interface Session extends DocumentObserver {
  commit<T>(change: (tx: Tx) => T | Promise<T>, context: Context): Promise<T>;
  close(context: Context): Promise<void>;
  readonly closed: Promise<SessionEnd>;
  subscribeCommits(
    listener: (publication: CommitPublication, context: Context) => void,
  ): () => void;
  subscribeClose(listener: () => void): () => void;

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
}
