import { type Context, type Draft, type JsonValue, copyJson } from "@msa/chord";
import { Effect } from "effect";

import types from "../types.ts";
import type typesModule from "../types.types.ts";
import transactionAdopt from "./transaction-adopt.ts";
import transactionAssemble from "./transaction-assemble.ts";
import transactionDocs from "./transaction-docs.ts";
import transactionState from "./transaction-state.ts";
import transactionWrites from "./transaction-writes.ts";
import type transactionTypes from "./transaction.types.ts";

const {
  abortChanges,
  committedTask,
  createTxState,
  readStorage,
  readTable,
  stageTableWrite,
  stageTask,
  stagedConversations,
  stagedTasks,
  writeTable,
} = transactionState;
const { ROOT_CONVERSATION_ID } = types;
const { appendEntry, createSubmission, createTask, stageConversation } = transactionWrites;
const { openDoc, retireDoc } = transactionDocs;
const { settleFailure, settleSuccess } = transactionAssemble;
const { adoptPlans } = transactionAdopt;

export default class Transaction implements typesModule.Tx {
  readonly #state: transactionTypes.TxState;

  constructor(
    host: transactionTypes.TransactionHost,
    context: Context,
    scope: transactionTypes.TransactionScope = {},
  ) {
    this.#state = createTxState({ context, host, scope, self: this });
  }

  conversation(
    id: typesModule.ConversationId,
  ): Promise<typesModule.ConversationRecord | undefined> {
    return readStorage(this.#state, "conversation", (storage, context) =>
      storage.conversation(id, context),
    );
  }

  entry(id: typesModule.EntryId): Promise<typesModule.EntryRecord | undefined>;
  entry<D extends JsonValue>(
    token: typesModule.Entry<D>,
    id: typesModule.EntryId,
  ): Promise<typesModule.TypedEntry<D> | undefined>;
  entry(
    first: typesModule.EntryId | { readonly kind: string },
    second?: typesModule.EntryId,
  ): Promise<typesModule.EntryRecord | undefined> {
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

  task(id: typesModule.TaskId): Promise<transactionTypes.AnyTaskRecord | undefined> {
    const state = this.#state;
    return readTable(state, "task", () => committedTask(state, id));
  }

  scanConversations(
    query: typesModule.ConversationQuery,
    limit: number,
    cursor?: typesModule.Cursor,
  ) {
    return readStorage(this.#state, "scanConversations", (storage, context) =>
      storage.scanConversations(query, limit, cursor, context),
    );
  }

  scanEntries(query: typesModule.EntryQuery, limit: number, cursor?: typesModule.Cursor) {
    return readStorage(this.#state, "scanEntries", (storage, context) =>
      storage.scanEntries(query, limit, cursor, context),
    );
  }

  latestHeadMarker(conversationId: typesModule.ConversationId) {
    return readStorage(this.#state, "latestHeadMarker", (storage, context) =>
      storage.findLatestHeadMarker(conversationId, undefined, context),
    );
  }

  scanTasks(query: typesModule.TaskQuery, limit: number, cursor?: typesModule.Cursor) {
    return readStorage(this.#state, "scanTasks", (storage, context) =>
      storage.scanTasks(query, limit, cursor, context),
    );
  }

  submission(id: typesModule.SubmissionId): Promise<typesModule.SubmissionRecord | undefined> {
    return readStorage(this.#state, "submission", (storage, context) =>
      storage.submission(id, context),
    );
  }

  submissionByRequest(
    conversationId: typesModule.ConversationId,
    requestId: string,
  ): Promise<typesModule.SubmissionRecord | undefined> {
    return readStorage(this.#state, "submissionByRequest", (storage, context) =>
      storage.submissionByRequest(conversationId, requestId, context),
    );
  }

  createConversation(options: {
    readonly ownership: typesModule.ConversationOwnership;
  }): Promise<typesModule.ConversationRecord> {
    return this.#stageConversation(undefined, options.ownership, undefined);
  }

  createRootConversation(): Promise<typesModule.ConversationRecord> {
    return this.#stageConversation(undefined, { kind: "ownerless" }, ROOT_CONVERSATION_ID);
  }

  forkConversation(
    parentConversationId: typesModule.ConversationId,
    at: typesModule.EntryId,
    options: { readonly ownership: typesModule.ConversationOwnership },
  ): Promise<typesModule.ConversationRecord> {
    const parent = { at, conversationId: parentConversationId };
    return this.#stageConversation(parent, options.ownership, undefined);
  }

  appendEntry(
    conversationId: typesModule.ConversationId,
    value: typesModule.EntryDraft,
  ): Promise<typesModule.EntryRecord>;
  appendEntry<D extends JsonValue>(
    token: typesModule.Entry<D>,
    conversationId: typesModule.ConversationId,
    value: typesModule.TypedEntryDraft<NoInfer<D>>,
  ): Promise<typesModule.TypedEntry<D>>;
  appendEntry(
    first: typesModule.ConversationId | { readonly kind: string },
    second: typesModule.ConversationId | typesModule.EntryDraft,
    third?: object,
  ): Promise<typesModule.EntryRecord> {
    const [conversationId, value] =
      typeof first === "number"
        ? [first, second as typesModule.EntryDraft]
        : [
            second as typesModule.ConversationId,
            { ...third, kind: first.kind } as typesModule.EntryDraft,
          ];
    return writeTable(this.#state, appendEntry(this.#state, conversationId, value));
  }

  createTask<I, S extends { phase: string }, R, H extends object>(
    task: typesModule.Task<I, S, R, H>,
    input: I,
    options: typesModule.TaskOptions,
  ): Promise<typesModule.TaskId<R>> {
    return writeTable(this.#state, createTask(this.#state, task, input, options));
  }

  createSubmission(create: typesModule.SubmissionCreate): Promise<typesModule.SubmissionRecord> {
    return writeTable(this.#state, createSubmission(this.#state, create));
  }

  settleSubmission(
    id: typesModule.SubmissionId,
    settlement: typesModule.SubmissionSettlement,
  ): void {
    stageTableWrite(this.#state);
    const change = copyJson(settlement) as typesModule.SubmissionSettlement;
    this.#state.submissionChanges.push({ change, id });
  }

  placeSubmission(id: typesModule.SubmissionId, entry: typesModule.EntryId): void {
    stageTableWrite(this.#state);
    this.#state.submissionChanges.push({ change: { entry, status: "placed" }, id });
  }

  setTask(value: transactionTypes.AnyTaskRecord): void {
    stageTask(this.#state, value);
  }

  stagedTasks(): transactionTypes.AnyTaskRecord[] {
    return stagedTasks(this.#state);
  }

  stagedConversations(): typesModule.ConversationRecord[] {
    return stagedConversations(this.#state);
  }

  doc<T extends typesModule.JsonObject>(token: typesModule.SessionDocToken<T>): Promise<Draft<T>>;
  doc<T extends typesModule.JsonObject>(
    token: typesModule.ConversationDocToken<T>,
    conversationId: typesModule.ConversationId,
  ): Promise<Draft<T>>;
  doc<T extends typesModule.JsonObject>(
    token: typesModule.TaskDocToken<T>,
    taskId: typesModule.TaskId,
  ): Promise<Draft<T>>;
  doc<T extends typesModule.JsonObject, I extends JsonValue>(
    token: typesModule.SessionDocFamilyToken<T, I>,
    key: string,
    seed: I,
  ): Promise<Draft<T>>;
  doc<T extends typesModule.JsonObject, I extends JsonValue>(
    token: typesModule.ConversationDocFamilyToken<T, I>,
    conversationId: typesModule.ConversationId,
    key: string,
    seed: I,
  ): Promise<Draft<T>>;
  doc<T extends typesModule.JsonObject, I extends JsonValue>(
    token: typesModule.TaskDocFamilyToken<T, I>,
    taskId: typesModule.TaskId,
    key: string,
    seed: I,
  ): Promise<Draft<T>>;
  doc(
    token: transactionTypes.AnyDocToken,
    ...args: readonly unknown[]
  ): Promise<Draft<typesModule.JsonObject>> {
    return openDoc(this.#state, token, args);
  }

  retireDoc<T extends typesModule.JsonObject>(token: typesModule.SessionDocToken<T>): Promise<void>;
  retireDoc<T extends typesModule.JsonObject>(
    token: typesModule.ConversationDocToken<T>,
    conversationId: typesModule.ConversationId,
  ): Promise<void>;
  retireDoc<T extends typesModule.JsonObject>(
    token: typesModule.TaskDocToken<T>,
    taskId: typesModule.TaskId,
  ): Promise<void>;
  retireDoc<T extends typesModule.JsonObject, I extends JsonValue>(
    token: typesModule.SessionDocFamilyToken<T, I>,
    key: string,
  ): Promise<void>;
  retireDoc<T extends typesModule.JsonObject, I extends JsonValue>(
    token: typesModule.ConversationDocFamilyToken<T, I>,
    conversationId: typesModule.ConversationId,
    key: string,
  ): Promise<void>;
  retireDoc<T extends typesModule.JsonObject, I extends JsonValue>(
    token: typesModule.TaskDocFamilyToken<T, I>,
    taskId: typesModule.TaskId,
    key: string,
  ): Promise<void>;
  retireDoc(token: transactionTypes.AnyDocToken, ...args: readonly unknown[]): Promise<void> {
    return retireDoc(this.#state, token, args);
  }

  settleFailure(): Effect.Effect<void> {
    return settleFailure(this.#state);
  }

  settleSuccess(): Effect.Effect<readonly typesModule.StorageWrite[]> {
    return settleSuccess(this.#state);
  }

  discard(): void {
    abortChanges(this.#state);
  }

  adopt(seq: typesModule.Seq): typesModule.DocumentCommitChange[] {
    return adoptPlans(this.#state, seq);
  }

  #stageConversation(
    parent: typesModule.ConversationRecord["parent"],
    ownership: typesModule.ConversationOwnership,
    reservedId: typesModule.ConversationId | undefined,
  ): Promise<typesModule.ConversationRecord> {
    const state = this.#state;
    return writeTable(state, stageConversation(state, parent, ownership, reservedId));
  }
}
