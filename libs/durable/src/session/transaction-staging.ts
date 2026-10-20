import { Function } from "effect";

import type dualTypes from "../dual.ts";
import type typesModule from "../types.types.ts";
import transactionTypesModule2 from "./transaction-types.ts";
import type transactionTypesModule from "./transaction-types.types.ts";

const { copyTableJson } = transactionTypesModule2;

const assertOpen = (state: transactionTypesModule.TxState): void => {
  if (state.sealed) throw new Error("Transaction has settled");
};

const taskEntry: dualTypes.Dual2<
  transactionTypesModule.TxState,
  typesModule.TaskId,
  transactionTypesModule.TransactionTask
> = Function.dual(
  2,
  (
    state: transactionTypesModule.TxState,
    id: typesModule.TaskId,
  ): transactionTypesModule.TransactionTask => {
    let task = state.tasksById.get(id);
    if (task === undefined) {
      task = {};
      state.tasksById.set(id, task);
    }
    return task;
  },
);

const stampTimes: dualTypes.Dual3<
  transactionTypesModule.TxState,
  transactionTypesModule.AnyTaskRecord,
  transactionTypesModule.AnyTaskRecord | undefined,
  transactionTypesModule.AnyTaskRecord
> = Function.dual(
  3,
  (
    state: transactionTypesModule.TxState,
    value: transactionTypesModule.AnyTaskRecord,
    candidate: transactionTypesModule.AnyTaskRecord | undefined,
  ): transactionTypesModule.AnyTaskRecord => {
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

const stageTableWrite = (state: transactionTypesModule.TxState): void => {
  assertOpen(state);
  state.hasTableWrite = true;
};

const stageTask: dualTypes.Dual2<
  transactionTypesModule.TxState,
  transactionTypesModule.AnyTaskRecord,
  void
> = Function.dual(
  2,
  (state: transactionTypesModule.TxState, value: transactionTypesModule.AnyTaskRecord): void => {
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
      record: copyTableJson<transactionTypesModule.AnyTaskRecord>(stamped),
    };
  },
);

const stagedTasks = (
  state: transactionTypesModule.TxState,
): transactionTypesModule.AnyTaskRecord[] => {
  const records: transactionTypesModule.AnyTaskRecord[] = [];
  for (const task of state.tasksById.values())
    if (task.write !== undefined) records.push(task.write.record);
  return records;
};

const stagedConversations = (
  state: transactionTypesModule.TxState,
): typesModule.ConversationRecord[] => {
  const records: typesModule.ConversationRecord[] = [];
  for (const write of state.writes) if (write.type === "conversation") records.push(write.value);
  return records;
};

const transactionStaging = {
  assertOpen,
  stageTableWrite,
  stageTask,
  stagedConversations,
  stagedTasks,
  stampTimes,
  taskEntry,
};

export default transactionStaging;
