import type { Op } from "@msa/chord/delta";
import { Function } from "effect";

import { NestedCallDoc, type NestedCallState } from "./tool-types.ts";
import type {
  CommitChange,
  CommitPublication,
  ConversationId,
  Dual2,
  EntryRecord,
  NestedToolExecutionResult,
  SubmissionRecord,
  TaskId,
} from "./types.ts";

type TaskChange = Extract<CommitChange, { type: "task" }>;

export type TaskValue = TaskChange["value"];

export type Changes = {
  readonly entries: EntryRecord[];
  readonly tasks: Map<TaskId, TaskValue>;
  readonly submissions: SubmissionRecord[];
  readonly nestedResults: Map<TaskId, NestedToolExecutionResult>;
};

const nestedResult = (change: CommitChange, changes: Changes): void => {
  if (change.type !== "document" || change.value === null) return;
  if (change.record.kind !== NestedCallDoc.definition.kind) return;
  const state = change.value as NestedCallState;
  if (state.taskId === undefined || state.result === undefined) return;
  changes.nestedResults.set(state.taskId, state.result as unknown as NestedToolExecutionResult);
};

export const collect: Dual2<CommitPublication, ConversationId, Changes> = Function.dual(
  2,
  (publication: CommitPublication, conversationId: ConversationId): Changes => {
    const changes: Changes = {
      entries: [],
      tasks: new Map(),
      submissions: [],
      nestedResults: new Map(),
    };
    for (const change of publication.changes) {
      if (change.type === "document" && change.conversationId === conversationId)
        nestedResult(change, changes);
      if (change.type === "entry" && change.value.conversationId === conversationId)
        changes.entries.push(change.value);
      if (change.type === "task" && change.value.conversationId === conversationId)
        changes.tasks.set(change.value.id, change.value);
      if (change.type === "submission" && change.value.conversationId === conversationId)
        changes.submissions.push(change.value);
    }
    changes.submissions.sort((a, b) => a.id - b.id);
    return changes;
  },
);

export const quiet: Dual2<readonly Op[], Changes, boolean> = Function.dual(
  2,
  (viewOps: readonly Op[], changes: Changes): boolean =>
    viewOps.length === 0 &&
    changes.entries.length === 0 &&
    changes.tasks.size === 0 &&
    changes.submissions.length === 0,
);
