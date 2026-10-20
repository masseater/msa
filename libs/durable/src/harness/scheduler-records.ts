import type { JsonValue } from "@msa/chord";
import { Function } from "effect";

import type sessionTypes from "../session/session.types.ts";
import type schedulerTypesModule from "./scheduler-types.types.ts";

const conversationNode = (id: schedulerTypesModule.ConversationId): schedulerTypesModule.Node =>
  `c${id}`;

const conversationOf = (node: `c${number}`): schedulerTypesModule.ConversationId =>
  Number(node.slice(1)) as schedulerTypesModule.ConversationId;

const parentNode = (node: schedulerTypesModule.TaskNode): schedulerTypesModule.Node =>
  node.owner ?? conversationNode(node.conversationId);

const withAbortMark: schedulerTypesModule.Dual2<
  schedulerTypesModule.AnyTaskRecord,
  "restart" | undefined,
  schedulerTypesModule.AnyTaskRecord
> = Function.dual(
  2,
  (
    record: schedulerTypesModule.AnyTaskRecord,
    reason: "restart" | undefined,
  ): schedulerTypesModule.AnyTaskRecord => {
    const { abortReason: _reason, ...rest } = record;
    return {
      ...rest,
      abortRequested: true,
      ...(reason === undefined ? {} : { abortReason: reason }),
    } as schedulerTypesModule.AnyTaskRecord;
  },
);

const failedOutcome = (record: schedulerTypesModule.AnyTaskRecord): boolean => {
  const state = record.state;
  return (
    (state.status === "completing" || state.status === "terminal") &&
    state.outcome.status !== "completed"
  );
};

const cancellationIntent = (record: schedulerTypesModule.AnyTaskRecord): boolean =>
  record.state.status !== "terminal" && (record.abortRequested || failedOutcome(record));

const parentOf = (node: schedulerTypesModule.TaskNode): schedulerTypesModule.Up =>
  node.owner === undefined ? { conversation: node.conversationId } : { task: node.owner };

const nodeOf = (record: schedulerTypesModule.AnyTaskRecord): schedulerTypesModule.TaskNode => ({
  conversationId: record.conversationId,
  ...(record.owner === undefined ? {} : { owner: record.owner }),
  background: record.background,
});

const overlayOf = (tx: schedulerTypesModule.Transaction): schedulerTypesModule.Overlay => {
  const tasks = new Map(tx.stagedTasks().map((record) => [record.id, record]));
  const edges = new Map(
    tx.stagedConversations().map((record) => [record.id, record.owner?.taskId ?? null]),
  );
  return { edges, tasks };
};

const memoOf: schedulerTypesModule.Dual2<
  schedulerTypesModule.AnyTaskRecord | undefined,
  string,
  JsonValue | undefined
> = Function.dual(
  2,
  (record: schedulerTypesModule.AnyTaskRecord | undefined, name: string): JsonValue | undefined => {
    const memos = record?.memos;
    return memos !== undefined && Object.hasOwn(memos, name) ? memos[name] : undefined;
  },
);

const sessionMethod: schedulerTypesModule.Dual2<
  sessionTypes.SessionImpl,
  "snapshot" | "snapshotAsOf" | "watchDoc",
  (...args: readonly unknown[]) => Promise<unknown>
> = Function.dual(
  2,
  (
    session: sessionTypes.SessionImpl,
    name: "snapshot" | "snapshotAsOf" | "watchDoc",
  ): ((...args: readonly unknown[]) => Promise<unknown>) =>
    (session[name] as (...args: readonly unknown[]) => Promise<unknown>).bind(session),
);

const missingMigration: schedulerTypesModule.Dual2<
  schedulerTypesModule.AnyTaskRecord,
  schedulerTypesModule.ErasedDefinition,
  Error
> = Function.dual(
  2,
  (
    record: schedulerTypesModule.AnyTaskRecord,
    definition: schedulerTypesModule.ErasedDefinition,
  ): Error =>
    new Error(
      `Task ${record.kind} version ${definition.version} has no migration from ${record.version}`,
    ),
);

const erased = (task: schedulerTypesModule.AnyTask): schedulerTypesModule.ErasedDefinition =>
  task.definition as unknown as schedulerTypesModule.ErasedDefinition;

const endedError = (invocation: schedulerTypesModule.Invocation): Error =>
  new Error(`Task ${invocation.taskId} invocation has ended`);

const withState: schedulerTypesModule.Dual2<
  schedulerTypesModule.AnyTaskRecord,
  schedulerTypesModule.TaskState<JsonValue, JsonValue>,
  schedulerTypesModule.AnyTaskRecord
> = Function.dual(
  2,
  (
    record: schedulerTypesModule.AnyTaskRecord,
    state: schedulerTypesModule.TaskState<JsonValue, JsonValue>,
  ): schedulerTypesModule.AnyTaskRecord => {
    if (state.status !== "terminal" && state.status !== "completing")
      return { ...record, state } as schedulerTypesModule.AnyTaskRecord;
    const { memos: _memos, ...rest } = record;
    return { ...rest, state };
  },
);

const canReserve: schedulerTypesModule.Dual2<
  schedulerTypesModule.AnyTask,
  schedulerTypesModule.AnyTaskRecord,
  boolean
> = Function.dual(
  2,
  (task: schedulerTypesModule.AnyTask, record: schedulerTypesModule.AnyTaskRecord): boolean => {
    const definition = task.definition;
    return (
      definition.version === record.version ||
      (definition.version > record.version && definition.migrate !== undefined)
    );
  },
);

const jsonEqual: schedulerTypesModule.Dual2<JsonValue | undefined, JsonValue | undefined, boolean> =
  Function.dual(2, (left: JsonValue | undefined, right: JsonValue | undefined): boolean => {
    if (left === right) return true;
    if (typeof left !== "object" || typeof right !== "object" || left === null || right === null)
      return false;
    if (Array.isArray(left) || Array.isArray(right)) {
      if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length)
        return false;
      return left.every((value, index) => jsonEqual(value, right[index]));
    }
    const keys = Object.keys(left);
    if (keys.length !== Object.keys(right).length) return false;
    return keys.every((key) => Object.hasOwn(right, key) && jsonEqual(left[key], right[key]));
  });

const schedulerRecords = {
  canReserve,
  cancellationIntent,
  conversationNode,
  conversationOf,
  endedError,
  erased,
  failedOutcome,
  jsonEqual,
  memoOf,
  missingMigration,
  nodeOf,
  overlayOf,
  parentNode,
  parentOf,
  sessionMethod,
  withAbortMark,
  withState,
};

export default schedulerRecords;
