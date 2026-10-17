import { Effect, Function } from "effect";

import { addressId } from "../documents.ts";
import type { Dual2, Dual3, Dual4 } from "../dual.ts";
import type {
  ConversationId,
  ConversationOwnership,
  ConversationRecord,
  EntryDraft,
  EntryId,
  EntryRecord,
  SubmissionCreate,
  SubmissionId,
  SubmissionRecord,
  Task,
  TaskId,
  TaskOptions,
} from "../types.ts";
import { prepareForkDocumentCopies } from "./forks.ts";
import { assertOpen, currentTask, mintId, requireConversation } from "./transaction-state.ts";
import {
  type AnyTaskRecord,
  copyTableJson,
  type DocumentEntry,
  type TxState,
} from "./transaction-types.ts";

type ConversationParent = NonNullable<ConversationRecord["parent"]>;

const conversationOwner = Effect.fn("conversationOwner")(function* (
  state: TxState,
  ownership: ConversationOwnership,
) {
  if (ownership.kind !== "task") return undefined;
  const task = yield* currentTask(state, ownership.taskId);
  assertOpen(state);
  if (task === undefined)
    throw new Error(`Conversation owner task ${ownership.taskId} does not exist`);
  return { conversationId: task.conversationId, taskId: ownership.taskId };
});

const stageForkCopies = Effect.fn("stageForkCopies")(function* (
  state: TxState,
  parent: ConversationParent | undefined,
  id: ConversationId,
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
    const entry: DocumentEntry = {
      addressId: addressId(copy.record),
      address: copy.record,
      target: { kind: "fork-copy", ...copy },
      retireOnCommit: false,
    };
    state.documents.push(entry);
    state.latestDocumentByAddress.set(entry.addressId, entry);
  }
  state.forkSourceConversationIds.add(parent.conversationId);
});

export const stageConversation: Dual4<
  TxState,
  ConversationParent | undefined,
  ConversationOwnership,
  ConversationId | undefined,
  Effect.Effect<ConversationRecord>
> = Function.dual(
  4,
  Effect.fn("stageConversation")(function* (
    state: TxState,
    parent: ConversationParent | undefined,
    ownership: ConversationOwnership,
    reservedId: ConversationId | undefined,
  ) {
    const id = reservedId ?? (yield* mintId<ConversationId>(state));
    assertOpen(state);
    const owner = yield* conversationOwner(state, ownership);
    const record: ConversationRecord = {
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

export const appendEntry: Dual3<
  TxState,
  ConversationId,
  EntryDraft,
  Effect.Effect<EntryRecord>
> = Function.dual(
  3,
  Effect.fn("appendEntry")(function* (
    state: TxState,
    conversationId: ConversationId,
    value: EntryDraft,
  ) {
    yield* requireConversation(state, conversationId);
    assertOpen(state);
    const id = yield* mintId<EntryId>(state);
    assertOpen(state);
    const { head, ...rest } = value;
    const record = copyTableJson<EntryRecord>({
      ...rest,
      id,
      conversationId,
      head: head === "self" ? id : head,
      byTaskId: state.scope.taskId,
    });
    state.writes.push({ type: "entry", value: record });
    return record;
  }),
);

const taskOwner = Effect.fn("taskOwner")(function* (state: TxState, options: TaskOptions) {
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
  readonly id: TaskId;
  readonly conversationId: ConversationId;
  readonly definition: { readonly name: string; readonly version: number };
  readonly input: unknown;
  readonly checkpoint: unknown;
  readonly owner: AnyTaskRecord | undefined;
  readonly options: TaskOptions;
}): AnyTaskRecord => {
  const { id, conversationId, definition, input, checkpoint, owner, options } = draft;
  return copyTableJson<AnyTaskRecord>({
    id,
    conversationId,
    kind: definition.name,
    version: definition.version,
    input,
    ...(owner === undefined ? {} : { owner: owner.id }),
    background: options.background ?? false,
    abortRequested: false,
    ...(options.abandonOnRestart === true ? { abandonOnRestart: true } : {}),
    state: { status: "pending", checkpoint },
  });
};

export const createTask: {
  <I, S extends { phase: string }, R, H extends object>(
    task: Task<I, S, R, H>,
    input: I,
    options: TaskOptions,
  ): (state: TxState) => Effect.Effect<TaskId<R>>;
  <I, S extends { phase: string }, R, H extends object>(
    state: TxState,
    task: Task<I, S, R, H>,
    input: I,
    options: TaskOptions,
  ): Effect.Effect<TaskId<R>>;
} = Function.dual(
  4,
  Effect.fn("createTask")(function* <I, S extends { phase: string }, R, H extends object>(
    state: TxState,
    task: Task<I, S, R, H>,
    input: I,
    options: TaskOptions,
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
    const id = yield* mintId<TaskId<R>>(state);
    assertOpen(state);
    const record = taskRecord({
      id,
      conversationId,
      definition,
      input,
      checkpoint,
      owner,
      options,
    });
    state.tasksById.set(id, { write: { kind: "create", record } });
    return id;
  }),
);

export const createSubmission: Dual2<
  TxState,
  SubmissionCreate,
  Effect.Effect<SubmissionRecord>
> = Function.dual(
  2,
  Effect.fn("createSubmission")(function* (state: TxState, create: SubmissionCreate) {
    yield* requireConversation(state, create.conversationId);
    assertOpen(state);
    const id = yield* mintId<SubmissionId>(state);
    assertOpen(state);
    const record = copyTableJson<SubmissionRecord>({ ...create, id });
    state.submissions.set(id, record);
    return record;
  }),
);
