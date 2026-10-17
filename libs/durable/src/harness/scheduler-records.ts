import type { JsonValue } from "@msa/chord";
import { Function } from "effect";

import type { SessionImpl } from "../session/session.ts";
import type {
  AnyTask,
  AnyTaskRecord,
  ConversationId,
  Dual2,
  ErasedDefinition,
  Invocation,
  Node,
  Overlay,
  TaskNode,
  TaskState,
  Transaction,
  Up,
} from "./scheduler-types.ts";

export const conversationNode = (id: ConversationId): Node => `c${id}`;

export const conversationOf = (node: `c${number}`): ConversationId =>
  Number(node.slice(1)) as ConversationId;

export const parentNode = (node: TaskNode): Node =>
  node.owner ?? conversationNode(node.conversationId);

export const withAbortMark: Dual2<AnyTaskRecord, "restart" | undefined, AnyTaskRecord> =
  Function.dual(2, (record: AnyTaskRecord, reason: "restart" | undefined): AnyTaskRecord => {
    const { abortReason: _reason, ...rest } = record;
    return {
      ...rest,
      abortRequested: true,
      ...(reason === undefined ? {} : { abortReason: reason }),
    } as AnyTaskRecord;
  });

export const failedOutcome = (record: AnyTaskRecord): boolean => {
  const state = record.state;
  return (
    (state.status === "completing" || state.status === "terminal") &&
    state.outcome.status !== "completed"
  );
};

export const cancellationIntent = (record: AnyTaskRecord): boolean =>
  record.state.status !== "terminal" && (record.abortRequested || failedOutcome(record));

export const parentOf = (node: TaskNode): Up =>
  node.owner === undefined ? { conversation: node.conversationId } : { task: node.owner };

export const nodeOf = (record: AnyTaskRecord): TaskNode => ({
  conversationId: record.conversationId,
  ...(record.owner === undefined ? {} : { owner: record.owner }),
  background: record.background,
});

export const overlayOf = (tx: Transaction): Overlay => {
  const tasks = new Map(tx.stagedTasks().map((record) => [record.id, record]));
  const edges = new Map(
    tx.stagedConversations().map((record) => [record.id, record.owner?.taskId ?? null]),
  );
  return { tasks, edges };
};

export const memoOf: Dual2<AnyTaskRecord | undefined, string, JsonValue | undefined> =
  Function.dual(2, (record: AnyTaskRecord | undefined, name: string): JsonValue | undefined => {
    const memos = record?.memos;
    return memos !== undefined && Object.hasOwn(memos, name) ? memos[name] : undefined;
  });

export const sessionMethod: Dual2<
  SessionImpl,
  "snapshot" | "snapshotAsOf" | "watchDoc",
  (...args: readonly unknown[]) => Promise<unknown>
> = Function.dual(
  2,
  (
    session: SessionImpl,
    name: "snapshot" | "snapshotAsOf" | "watchDoc",
  ): ((...args: readonly unknown[]) => Promise<unknown>) =>
    (session[name] as (...args: readonly unknown[]) => Promise<unknown>).bind(session),
);

export const missingMigration: Dual2<AnyTaskRecord, ErasedDefinition, Error> = Function.dual(
  2,
  (record: AnyTaskRecord, definition: ErasedDefinition): Error =>
    new Error(
      `Task ${record.kind} version ${definition.version} has no migration from ${record.version}`,
    ),
);

export const erased = (task: AnyTask): ErasedDefinition =>
  task.definition as unknown as ErasedDefinition;

export const endedError = (invocation: Invocation): Error =>
  new Error(`Task ${invocation.taskId} invocation has ended`);

export const withState: Dual2<
  AnyTaskRecord,
  TaskState<JsonValue, JsonValue>,
  AnyTaskRecord
> = Function.dual(
  2,
  (record: AnyTaskRecord, state: TaskState<JsonValue, JsonValue>): AnyTaskRecord => {
    if (state.status !== "terminal" && state.status !== "completing")
      return { ...record, state } as AnyTaskRecord;
    const { memos: _memos, ...rest } = record;
    return { ...rest, state };
  },
);

export const canReserve: Dual2<AnyTask, AnyTaskRecord, boolean> = Function.dual(
  2,
  (task: AnyTask, record: AnyTaskRecord): boolean => {
    const definition = task.definition;
    return (
      definition.version === record.version ||
      (definition.version > record.version && definition.migrate !== undefined)
    );
  },
);

export const jsonEqual: Dual2<JsonValue | undefined, JsonValue | undefined, boolean> =
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
