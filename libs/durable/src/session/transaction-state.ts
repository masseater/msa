import { Effect, Function } from "effect";

import type { ResolvedAddress } from "../documents.ts";
import type { Dual2, Dual3 } from "../dual.ts";
import { ReadAfterWrite } from "../errors.ts";
import type { ConversationId, ConversationRecord, Id, TaskId } from "../types.ts";
import {
  type AnyTaskRecord,
  copyTableJson,
  type TransactionHost,
  type TransactionScope,
  type TransactionTask,
  type TxState,
} from "./transaction-types.ts";
import type { Transaction } from "./transaction.ts";

export const createTxState = (init: {
  readonly self: Transaction;
  readonly host: TransactionHost;
  readonly context: TxState["context"];
  readonly scope: TransactionScope;
}): TxState => ({
  ...init,
  pendingOperations: new Set(),
  sealed: false,
  hasTableWrite: false,
  writes: [],
  createdConversationIds: new Set(),
  forkSourceConversationIds: new Set(),
  forkSourceDocumentIds: new Set(),
  tasksById: new Map(),
  submissions: new Map(),
  submissionChanges: [],
  plans: [],
  documents: [],
  latestDocumentByAddress: new Map(),
});

export const assertOpen = (state: TxState): void => {
  if (state.sealed) throw new Error("Transaction has settled");
};

export const abortChanges = (state: TxState): void => {
  for (const document of state.documents) document.change?.abort();
};

export const track: {
  <T>(operation: Promise<T>): (state: TxState) => Promise<T>;
  <T>(state: TxState, operation: Promise<T>): Promise<T>;
} = Function.dual(2, <T>(state: TxState, operation: Promise<T>): Promise<T> => {
  state.pendingOperations.add(operation);
  const settle = (): void => {
    state.pendingOperations.delete(operation);
  };
  operation.then(settle, settle);
  return operation;
});

export const readTable: {
  <T>(method: string, read: () => Promise<T>): (state: TxState) => Promise<T>;
  <T>(state: TxState, method: string, read: () => Promise<T>): Promise<T>;
} = Function.dual(3, <T>(state: TxState, method: string, read: () => Promise<T>): Promise<T> => {
  try {
    assertOpen(state);
    if (state.hasTableWrite) throw new ReadAfterWrite(method);
    return track(state, read());
  } catch (error) {
    return Promise.reject(error);
  }
});

export const readStorage: {
  <T>(
    method: string,
    read: (storage: TransactionHost["storage"], context: TxState["context"]) => Promise<T>,
  ): (state: TxState) => Promise<T>;
  <T>(
    state: TxState,
    method: string,
    read: (storage: TransactionHost["storage"], context: TxState["context"]) => Promise<T>,
  ): Promise<T>;
} = Function.dual(
  3,
  <T>(
    state: TxState,
    method: string,
    read: (storage: TransactionHost["storage"], context: TxState["context"]) => Promise<T>,
  ): Promise<T> => readTable(state, method, () => read(state.host.storage, state.context)),
);

export const writeTable: {
  <T>(write: Effect.Effect<T>): (state: TxState) => Promise<T>;
  <T>(state: TxState, write: Effect.Effect<T>): Promise<T>;
} = Function.dual(2, <T>(state: TxState, write: Effect.Effect<T>): Promise<T> => {
  try {
    assertOpen(state);
    state.hasTableWrite = true;
    return track(state, Effect.runPromise(write));
  } catch (error) {
    return Promise.reject(error);
  }
});

export const mintId = <I extends Id<string>>(state: TxState): Effect.Effect<I> =>
  Effect.promise(() => state.host.storage.mintId<I>());

export const taskEntry: Dual2<TxState, TaskId, TransactionTask> = Function.dual(
  2,
  (state: TxState, id: TaskId): TransactionTask => {
    let task = state.tasksById.get(id);
    if (task === undefined) {
      task = {};
      state.tasksById.set(id, task);
    }
    return task;
  },
);

export const committedTask: Dual2<
  TxState,
  TaskId,
  Promise<AnyTaskRecord | undefined>
> = Function.dual(2, (state: TxState, id: TaskId): Promise<AnyTaskRecord | undefined> => {
  const task = taskEntry(state, id);
  task.committedRead ??= state.host.storage.task(id, state.context);
  return task.committedRead;
});

export const currentTask: Dual2<
  TxState,
  TaskId,
  Effect.Effect<AnyTaskRecord | undefined>
> = Function.dual(2, (state: TxState, id: TaskId) =>
  Effect.suspend(() => {
    const staged = state.tasksById.get(id)?.write?.record;
    if (staged !== undefined) return Effect.succeed<AnyTaskRecord | undefined>(staged);
    return Effect.promise(() => committedTask(state, id));
  }),
);

export const requireConversation: Dual2<
  TxState,
  ConversationId,
  Effect.Effect<void>
> = Function.dual(
  2,
  Effect.fnUntraced(function* (state: TxState, id: ConversationId) {
    if (state.createdConversationIds.has(id)) return;
    const record = yield* Effect.promise(() => state.host.storage.conversation(id, state.context));
    if (record === undefined) throw new Error(`Conversation ${id} does not exist`);
  }),
);

export const stampTimes: Dual3<TxState, AnyTaskRecord, AnyTaskRecord | undefined, AnyTaskRecord> =
  Function.dual(
    3,
    (state: TxState, value: AnyTaskRecord, candidate: AnyTaskRecord | undefined): AnyTaskRecord => {
      const status = value.state.status;
      const now = (stamps: boolean) => (stamps ? state.host.now() : undefined);
      const startedAt = candidate?.startedAt ?? value.startedAt ?? now(status === "running");
      const endedAt = candidate?.endedAt ?? value.endedAt ?? now(status === "terminal");
      if (startedAt === value.startedAt && endedAt === value.endedAt) return value;
      return {
        ...value,
        ...(startedAt === undefined ? {} : { startedAt }),
        ...(endedAt === undefined ? {} : { endedAt }),
      };
    },
  );

export const assertTaskDocumentsOpen: Dual2<TxState, ResolvedAddress, void> = Function.dual(
  2,
  (state: TxState, resolved: ResolvedAddress): void => {
    const scope = resolved.address.scope;
    if (
      scope.kind === "task" &&
      state.tasksById.get(scope.taskId)?.write?.record.state.status === "terminal"
    ) {
      throw new Error(`Task ${scope.taskId} is terminal`);
    }
  },
);

export const stageTableWrite = (state: TxState): void => {
  assertOpen(state);
  state.hasTableWrite = true;
};

export const stageTask: Dual2<TxState, AnyTaskRecord, void> = Function.dual(
  2,
  (state: TxState, value: AnyTaskRecord): void => {
    stageTableWrite(state);
    const task = taskEntry(state, value.id);
    const candidate = task.write?.record;
    if (candidate?.state.status === "terminal") {
      throw new Error(`Task ${value.id} already has a terminal candidate`);
    }
    if (candidate !== undefined && candidate.conversationId !== value.conversationId) {
      throw new Error(`Task ${value.id} cannot change conversations`);
    }
    const stamped = stampTimes(state, value, candidate);
    task.write = {
      kind: task.write?.kind === "create" ? "create" : "replace",
      record: copyTableJson<AnyTaskRecord>(stamped),
    };
  },
);

export const stagedTasks = (state: TxState): AnyTaskRecord[] => {
  const records: AnyTaskRecord[] = [];
  for (const task of state.tasksById.values())
    if (task.write !== undefined) records.push(task.write.record);
  return records;
};

export const stagedConversations = (state: TxState): ConversationRecord[] => {
  const records: ConversationRecord[] = [];
  for (const write of state.writes) if (write.type === "conversation") records.push(write.value);
  return records;
};
