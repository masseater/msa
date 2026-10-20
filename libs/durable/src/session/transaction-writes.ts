import { Effect, Function } from "effect";

import documentsModule from "../documents.ts";
import type dualTypes from "../dual.ts";
import type typesModule from "../types.types.ts";
import forks from "./forks.ts";
import transactionState from "./transaction-state.ts";
import transactionTypes from "./transaction-types.ts";
import type transactionTypesModule from "./transaction-types.types.ts";

const { assertOpen, currentTask, mintId, requireConversation } = transactionState;
const { prepareForkDocumentCopies } = forks;
const { addressId } = documentsModule;
const { copyTableJson } = transactionTypes;

type ConversationParent = NonNullable<typesModule.ConversationRecord["parent"]>;

const conversationOwner = Effect.fnUntraced(function* (
  state: transactionTypesModule.TxState,
  ownership: typesModule.ConversationOwnership,
) {
  if (ownership.kind !== "task") return undefined;
  const task = yield* currentTask(state, ownership.taskId);
  assertOpen(state);
  if (task === undefined)
    throw new Error(`Conversation owner task ${ownership.taskId} does not exist`);
  return { conversationId: task.conversationId, taskId: ownership.taskId };
});

const stageForkCopies = Effect.fnUntraced(function* (
  state: transactionTypesModule.TxState,
  parent: ConversationParent | undefined,
  id: typesModule.ConversationId,
) {
  if (parent === undefined) return;
  const copies = yield* prepareForkDocumentCopies(
    state.host.storage,
    parent.conversationId,
    parent.at,
    id,
    state.context,
  );
  assertOpen(state);
  for (const copy of copies) {
    state.forkSourceDocumentIds.add(copy.source.id);
    const entry: transactionTypesModule.DocumentEntry = {
      address: copy.record,
      addressId: addressId(copy.record),
      retireOnCommit: false,
      target: { kind: "fork-copy", ...copy },
    };
    state.documents.push(entry);
    state.latestDocumentByAddress.set(entry.addressId, entry);
  }
  state.forkSourceConversationIds.add(parent.conversationId);
});

const stageConversation: dualTypes.Dual4<
  transactionTypesModule.TxState,
  ConversationParent | undefined,
  typesModule.ConversationOwnership,
  typesModule.ConversationId | undefined,
  Effect.Effect<typesModule.ConversationRecord>
> = Function.dual(
  4,
  Effect.fnUntraced(function* (
    state: transactionTypesModule.TxState,
    parent: ConversationParent | undefined,
    ownership: typesModule.ConversationOwnership,
    reservedId: typesModule.ConversationId | undefined,
  ) {
    const id = reservedId ?? (yield* mintId<typesModule.ConversationId>(state));
    assertOpen(state);
    const owner = yield* conversationOwner(state, ownership);
    const record: typesModule.ConversationRecord = {
      id,
      ...(parent === undefined ? {} : { parent }),
      ...(owner === undefined ? {} : { owner }),
    };
    yield* stageForkCopies(state, parent, id);
    if (parent === undefined) assertOpen(state);
    state.createdConversationIds.add(id);
    state.writes.push({ type: "conversation", value: record });
    yield* Effect.promise(() => state.host.conversationCreated(state.self, record));
    assertOpen(state);
    return record;
  }),
);

const appendEntry: dualTypes.Dual3<
  transactionTypesModule.TxState,
  typesModule.ConversationId,
  typesModule.EntryDraft,
  Effect.Effect<typesModule.EntryRecord>
> = Function.dual(
  3,
  Effect.fnUntraced(function* (
    state: transactionTypesModule.TxState,
    conversationId: typesModule.ConversationId,
    value: typesModule.EntryDraft,
  ) {
    yield* requireConversation(state, conversationId);
    assertOpen(state);
    const id = yield* mintId<typesModule.EntryId>(state);
    assertOpen(state);
    const { head, ...rest } = value;
    const record = copyTableJson<typesModule.EntryRecord>({
      ...rest,
      byTaskId: state.scope.taskId,
      conversationId,
      head: head === "self" ? id : head,
      id,
    });
    state.writes.push({ type: "entry", value: record });
    return record;
  }),
);

const taskOwner = Effect.fnUntraced(function* (
  state: transactionTypesModule.TxState,
  options: typesModule.TaskOptions,
) {
  const ownership = options.ownership;
  if (ownership.kind !== "task") return undefined;
  const owner = yield* currentTask(state, ownership.taskId);
  assertOpen(state);
  if (owner === undefined) throw new Error(`Task owner ${ownership.taskId} does not exist`);
  if (options.background === true) throw new TypeError("A child task cannot be background");
  if (options.conversationId !== undefined && options.conversationId !== owner.conversationId) {
    throw new Error(`A child task lives in its owner's conversation ${owner.conversationId}`);
  }
  return owner;
});

const taskRecord = (draft: {
  readonly id: typesModule.TaskId;
  readonly conversationId: typesModule.ConversationId;
  readonly definition: { readonly name: string; readonly version: number };
  readonly input: unknown;
  readonly checkpoint: unknown;
  readonly owner: transactionTypesModule.AnyTaskRecord | undefined;
  readonly options: typesModule.TaskOptions;
}): transactionTypesModule.AnyTaskRecord => {
  const { id, conversationId, definition, input, checkpoint, owner, options } = draft;
  return copyTableJson<transactionTypesModule.AnyTaskRecord>({
    conversationId,
    id,
    input,
    kind: definition.name,
    version: definition.version,
    ...(owner === undefined ? {} : { owner: owner.id }),
    abortRequested: false,
    background: options.background ?? false,
    ...(options.abandonOnRestart === true ? { abandonOnRestart: true } : {}),
    state: { checkpoint, status: "pending" },
  });
};

const createTask: {
  <I, S extends { phase: string }, R, H extends object>(
    task: typesModule.Task<I, S, R, H>,
    input: I,
    options: typesModule.TaskOptions,
  ): (state: transactionTypesModule.TxState) => Effect.Effect<typesModule.TaskId<R>>;
  <I, S extends { phase: string }, R, H extends object>(
    state: transactionTypesModule.TxState,
    task: typesModule.Task<I, S, R, H>,
    input: I,
    options: typesModule.TaskOptions,
  ): Effect.Effect<typesModule.TaskId<R>>;
} = Function.dual(
  4,
  Effect.fnUntraced(function* <I, S extends { phase: string }, R, H extends object>(
    state: transactionTypesModule.TxState,
    task: typesModule.Task<I, S, R, H>,
    input: I,
    options: typesModule.TaskOptions,
  ) {
    const owner = yield* taskOwner(state, options);
    const conversationId =
      owner?.conversationId ?? options.conversationId ?? state.scope.conversationId;
    if (conversationId === undefined)
      throw new TypeError("Tx.createTask() requires options.conversationId");
    yield* requireConversation(state, conversationId);
    assertOpen(state);
    const definition = task.definition;
    const checkpoint = definition.initial(input);
    const id = yield* mintId<typesModule.TaskId<R>>(state);
    assertOpen(state);
    const record = taskRecord({
      checkpoint,
      conversationId,
      definition,
      id,
      input,
      options,
      owner,
    });
    state.tasksById.set(id, { write: { kind: "create", record } });
    return id;
  }),
);

const createSubmission: dualTypes.Dual2<
  transactionTypesModule.TxState,
  typesModule.SubmissionCreate,
  Effect.Effect<typesModule.SubmissionRecord>
> = Function.dual(
  2,
  Effect.fnUntraced(function* (
    state: transactionTypesModule.TxState,
    create: typesModule.SubmissionCreate,
  ) {
    yield* requireConversation(state, create.conversationId);
    assertOpen(state);
    const id = yield* mintId<typesModule.SubmissionId>(state);
    assertOpen(state);
    const record = copyTableJson<typesModule.SubmissionRecord>({ ...create, id });
    state.submissions.set(id, record);
    return record;
  }),
);

const transactionWrites = {
  appendEntry,
  createSubmission,
  createTask,
  stageConversation,
};

export default transactionWrites;
