import { type Context, copyJson, type Draft, type JsonValue } from "@msa/chord";
import { Effect } from "effect";

import type { AnyDocToken } from "../documents.ts";
import {
  type ConversationDocFamilyToken,
  type ConversationDocToken,
  type ConversationId,
  type ConversationOwnership,
  type ConversationQuery,
  type ConversationRecord,
  type Cursor,
  type DocumentCommitChange,
  type Entry,
  type EntryDraft,
  type EntryId,
  type EntryQuery,
  type EntryRecord,
  type JsonObject,
  ROOT_CONVERSATION_ID,
  type Seq,
  type SessionDocFamilyToken,
  type SessionDocToken,
  type StorageWrite,
  type SubmissionCreate,
  type SubmissionId,
  type SubmissionRecord,
  type SubmissionSettlement,
  type Task,
  type TaskDocFamilyToken,
  type TaskDocToken,
  type TaskId,
  type TaskOptions,
  type TaskQuery,
  type Tx,
  type TypedEntry,
  type TypedEntryDraft,
} from "../types.ts";
import { adoptPlans } from "./transaction-adopt.ts";
import { settleFailure, settleSuccess } from "./transaction-assemble.ts";
import { openDoc, retireDoc } from "./transaction-docs.ts";
import {
  abortChanges,
  committedTask,
  createTxState,
  readStorage,
  readTable,
  stagedConversations,
  stagedTasks,
  stageTableWrite,
  stageTask,
  writeTable,
} from "./transaction-state.ts";
import {
  type AnyTaskRecord,
  type TransactionHost,
  type TransactionScope,
  type TxState,
} from "./transaction-types.ts";
import {
  appendEntry,
  createSubmission,
  createTask,
  stageConversation,
} from "./transaction-writes.ts";

export class Transaction implements Tx {
  readonly #state: TxState;

  constructor(host: TransactionHost, context: Context, scope: TransactionScope = {}) {
    this.#state = createTxState({ self: this, host, context, scope });
  }

  conversation(id: ConversationId): Promise<ConversationRecord | undefined> {
    return readStorage(this.#state, "conversation", (storage, context) =>
      storage.conversation(id, context),
    );
  }

  entry(id: EntryId): Promise<EntryRecord | undefined>;
  entry<D extends JsonValue>(token: Entry<D>, id: EntryId): Promise<TypedEntry<D> | undefined>;
  entry(
    first: EntryId | { readonly kind: string },
    second?: EntryId,
  ): Promise<EntryRecord | undefined> {
    const kind = typeof first === "number" ? undefined : first.kind;
    const id = typeof first === "number" ? first : second!;
    const { host, context } = this.#state;
    return readTable(this.#state, "entry", () =>
      host.storage.entry(id, context).then((found) => {
        const entry = found?.entry;
        return kind === undefined || entry?.kind === kind ? entry : undefined;
      }),
    );
  }

  task(id: TaskId): Promise<AnyTaskRecord | undefined> {
    const state = this.#state;
    return readTable(state, "task", () => committedTask(state, id));
  }

  scanConversations(query: ConversationQuery, limit: number, cursor?: Cursor) {
    return readStorage(this.#state, "scanConversations", (storage, context) =>
      storage.scanConversations(query, limit, cursor, context),
    );
  }

  scanEntries(query: EntryQuery, limit: number, cursor?: Cursor) {
    return readStorage(this.#state, "scanEntries", (storage, context) =>
      storage.scanEntries(query, limit, cursor, context),
    );
  }

  latestHeadMarker(conversationId: ConversationId) {
    return readStorage(this.#state, "latestHeadMarker", (storage, context) =>
      storage.findLatestHeadMarker(conversationId, undefined, context),
    );
  }

  scanTasks(query: TaskQuery, limit: number, cursor?: Cursor) {
    return readStorage(this.#state, "scanTasks", (storage, context) =>
      storage.scanTasks(query, limit, cursor, context),
    );
  }

  submission(id: SubmissionId): Promise<SubmissionRecord | undefined> {
    return readStorage(this.#state, "submission", (storage, context) =>
      storage.submission(id, context),
    );
  }

  submissionByRequest(
    conversationId: ConversationId,
    requestId: string,
  ): Promise<SubmissionRecord | undefined> {
    return readStorage(this.#state, "submissionByRequest", (storage, context) =>
      storage.submissionByRequest(conversationId, requestId, context),
    );
  }

  createConversation(options: {
    readonly ownership: ConversationOwnership;
  }): Promise<ConversationRecord> {
    return this.#stageConversation(undefined, options.ownership, undefined);
  }

  createRootConversation(): Promise<ConversationRecord> {
    return this.#stageConversation(undefined, { kind: "ownerless" }, ROOT_CONVERSATION_ID);
  }

  forkConversation(
    parentConversationId: ConversationId,
    at: EntryId,
    options: { readonly ownership: ConversationOwnership },
  ): Promise<ConversationRecord> {
    const parent = { conversationId: parentConversationId, at };
    return this.#stageConversation(parent, options.ownership, undefined);
  }

  appendEntry(conversationId: ConversationId, value: EntryDraft): Promise<EntryRecord>;
  appendEntry<D extends JsonValue>(
    token: Entry<D>,
    conversationId: ConversationId,
    value: TypedEntryDraft<NoInfer<D>>,
  ): Promise<TypedEntry<D>>;
  appendEntry(
    first: ConversationId | { readonly kind: string },
    second: ConversationId | EntryDraft,
    third?: object,
  ): Promise<EntryRecord> {
    const [conversationId, value] =
      typeof first === "number"
        ? [first, second as EntryDraft]
        : [second as ConversationId, { ...third, kind: first.kind } as EntryDraft];
    return writeTable(this.#state, appendEntry(this.#state, conversationId, value));
  }

  createTask<I, S extends { phase: string }, R, H extends object>(
    task: Task<I, S, R, H>,
    input: I,
    options: TaskOptions,
  ): Promise<TaskId<R>> {
    return writeTable(this.#state, createTask(this.#state, task, input, options));
  }

  createSubmission(create: SubmissionCreate): Promise<SubmissionRecord> {
    return writeTable(this.#state, createSubmission(this.#state, create));
  }

  settleSubmission(id: SubmissionId, settlement: SubmissionSettlement): void {
    stageTableWrite(this.#state);
    const change = copyJson(settlement) as SubmissionSettlement;
    this.#state.submissionChanges.push({ id, change });
  }

  placeSubmission(id: SubmissionId, entry: EntryId): void {
    stageTableWrite(this.#state);
    this.#state.submissionChanges.push({ id, change: { status: "placed", entry } });
  }

  setTask(value: AnyTaskRecord): void {
    stageTask(this.#state, value);
  }

  stagedTasks(): AnyTaskRecord[] {
    return stagedTasks(this.#state);
  }

  stagedConversations(): ConversationRecord[] {
    return stagedConversations(this.#state);
  }

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
  doc(token: AnyDocToken, ...args: readonly unknown[]): Promise<Draft<JsonObject>> {
    return openDoc(this.#state, token, args);
  }

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
  retireDoc(token: AnyDocToken, ...args: readonly unknown[]): Promise<void> {
    return retireDoc(this.#state, token, args);
  }

  settleFailure(): Effect.Effect<void> {
    return settleFailure(this.#state);
  }

  settleSuccess(): Effect.Effect<readonly StorageWrite[]> {
    return settleSuccess(this.#state);
  }

  discard(): void {
    abortChanges(this.#state);
  }

  adopt(seq: Seq): DocumentCommitChange[] {
    return adoptPlans(this.#state, seq);
  }

  #stageConversation(
    parent: ConversationRecord["parent"],
    ownership: ConversationOwnership,
    reservedId: ConversationId | undefined,
  ): Promise<ConversationRecord> {
    const state = this.#state;
    return writeTable(state, stageConversation(state, parent, ownership, reservedId));
  }
}
