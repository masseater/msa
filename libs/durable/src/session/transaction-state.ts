import { Effect, Function } from "effect";

import type documentsTypes from "../documents.types.ts";
import type dualTypes from "../dual.ts";
import errors from "../errors.ts";
import type typesModule from "../types.types.ts";
import transactionStaging from "./transaction-staging.ts";
import type transactionTypesModule from "./transaction-types.types.ts";
import type transactionTypes from "./transaction.types.ts";

const {
  assertOpen,
  stageTableWrite,
  stageTask,
  stagedConversations,
  stagedTasks,
  stampTimes,
  taskEntry,
} = transactionStaging;

const { ReadAfterWrite } = errors;
const createTxState = (init: {
  readonly self: transactionTypes.Transaction;
  readonly host: transactionTypesModule.TransactionHost;
  readonly context: transactionTypesModule.TxState["context"];
  readonly scope: transactionTypesModule.TransactionScope;
}): transactionTypesModule.TxState => ({
  ...init,
  createdConversationIds: new Set(),
  documents: [],
  forkSourceConversationIds: new Set(),
  forkSourceDocumentIds: new Set(),
  hasTableWrite: false,
  latestDocumentByAddress: new Map(),
  pendingOperations: new Set(),
  plans: [],
  sealed: false,
  submissionChanges: [],
  submissions: new Map(),
  tasksById: new Map(),
  writes: [],
});
const abortChanges = (state: transactionTypesModule.TxState): void => {
  for (const document of state.documents) document.change?.abort();
};

const track: {
  <T>(operation: Promise<T>): (state: transactionTypesModule.TxState) => Promise<T>;
  <T>(state: transactionTypesModule.TxState, operation: Promise<T>): Promise<T>;
} = Function.dual(
  2,
  <T>(state: transactionTypesModule.TxState, operation: Promise<T>): Promise<T> => {
    state.pendingOperations.add(operation);
    const settle = (): void => {
      state.pendingOperations.delete(operation);
    };
    operation.then(settle, settle);
    return operation;
  },
);

const readTable: {
  <T>(
    method: string,
    read: () => Promise<T>,
  ): (state: transactionTypesModule.TxState) => Promise<T>;
  <T>(state: transactionTypesModule.TxState, method: string, read: () => Promise<T>): Promise<T>;
} = Function.dual(
  3,
  <T>(
    state: transactionTypesModule.TxState,
    method: string,
    read: () => Promise<T>,
  ): Promise<T> => {
    try {
      assertOpen(state);
      if (state.hasTableWrite) throw ReadAfterWrite.create(method);
      return track(state, read());
    } catch (error) {
      return Promise.reject(error);
    }
  },
);

const readStorage: {
  <T>(
    method: string,
    read: (
      storage: transactionTypesModule.TransactionHost["storage"],
      context: transactionTypesModule.TxState["context"],
    ) => Promise<T>,
  ): (state: transactionTypesModule.TxState) => Promise<T>;
  <T>(
    state: transactionTypesModule.TxState,
    method: string,
    read: (
      storage: transactionTypesModule.TransactionHost["storage"],
      context: transactionTypesModule.TxState["context"],
    ) => Promise<T>,
  ): Promise<T>;
} = Function.dual(
  3,
  <T>(
    state: transactionTypesModule.TxState,
    method: string,
    read: (
      storage: transactionTypesModule.TransactionHost["storage"],
      context: transactionTypesModule.TxState["context"],
    ) => Promise<T>,
  ): Promise<T> => readTable(state, method, () => read(state.host.storage, state.context)),
);

const writeTable: {
  <T>(write: Effect.Effect<T>): (state: transactionTypesModule.TxState) => Promise<T>;
  <T>(state: transactionTypesModule.TxState, write: Effect.Effect<T>): Promise<T>;
} = Function.dual(
  2,
  <T>(state: transactionTypesModule.TxState, write: Effect.Effect<T>): Promise<T> => {
    try {
      assertOpen(state);
      state.hasTableWrite = true;
      return track(state, Effect.runPromise(write));
    } catch (error) {
      return Promise.reject(error);
    }
  },
);

const mintId = <I extends typesModule.Id<string>>(
  state: transactionTypesModule.TxState,
): Effect.Effect<I> => Effect.promise(() => state.host.storage.mintId<I>());
const committedTask: dualTypes.Dual2<
  transactionTypesModule.TxState,
  typesModule.TaskId,
  Promise<transactionTypesModule.AnyTaskRecord | undefined>
> = Function.dual(
  2,
  (
    state: transactionTypesModule.TxState,
    id: typesModule.TaskId,
  ): Promise<transactionTypesModule.AnyTaskRecord | undefined> => {
    const task = taskEntry(state, id);
    task.committedRead ??= state.host.storage.task(id, state.context);
    return task.committedRead;
  },
);

const currentTask: dualTypes.Dual2<
  transactionTypesModule.TxState,
  typesModule.TaskId,
  Effect.Effect<transactionTypesModule.AnyTaskRecord | undefined>
> = Function.dual(2, (state: transactionTypesModule.TxState, id: typesModule.TaskId) =>
  Effect.suspend(() => {
    const staged = state.tasksById.get(id)?.write?.record;
    if (staged !== undefined)
      return Effect.succeed<transactionTypesModule.AnyTaskRecord | undefined>(staged);
    return Effect.promise(() => committedTask(state, id));
  }),
);

const requireConversation: dualTypes.Dual2<
  transactionTypesModule.TxState,
  typesModule.ConversationId,
  Effect.Effect<void>
> = Function.dual(
  2,
  Effect.fnUntraced(function* (
    state: transactionTypesModule.TxState,
    id: typesModule.ConversationId,
  ) {
    if (state.createdConversationIds.has(id)) return;
    const record = yield* Effect.promise(() => state.host.storage.conversation(id, state.context));
    if (record === undefined) throw new Error(`Conversation ${id} does not exist`);
  }),
);
const assertTaskDocumentsOpen: dualTypes.Dual2<
  transactionTypesModule.TxState,
  documentsTypes.ResolvedAddress,
  void
> = Function.dual(
  2,
  (state: transactionTypesModule.TxState, resolved: documentsTypes.ResolvedAddress): void => {
    const scope = resolved.address.scope;
    if (
      scope.kind === "task" &&
      state.tasksById.get(scope.taskId)?.write?.record.state.status === "terminal"
    ) {
      throw new Error(`Task ${scope.taskId} is terminal`);
    }
  },
);
const transactionState = {
  abortChanges,
  assertOpen,
  assertTaskDocumentsOpen,
  committedTask,
  createTxState,
  currentTask,
  mintId,
  readStorage,
  readTable,
  requireConversation,
  stageTableWrite,
  stageTask,
  stagedConversations,
  stagedTasks,
  stampTimes,
  taskEntry,
  track,
  writeTable,
};

export default transactionState;
