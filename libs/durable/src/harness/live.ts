import type { AssistantMessage, Usage } from "@msa/ai";
import type { Draft, JsonRepresentation, JsonValue } from "@msa/chord";
import { Effect, Function } from "effect";

import { defineDoc } from "../documents.ts";
import type { Transaction } from "../session/transaction.ts";
import { convertPartial } from "./generation.ts";
import type { SchedulerOutcome } from "./scheduler.ts";
import type {
  CompactionReason,
  CompactionResult,
  Dual2,
  Dual3,
  Dual4,
  EntryId,
  JsonObject,
  SubmissionId,
  SubmissionSettlement,
  TaskId,
  TaskRecord,
  ToolDiagnostic,
  Tx,
} from "./types.ts";

type SlotProgress = {
  callId: string;
  name: string;
  status: "pending" | "running" | "done";
  output?: string;
  droppedBytes?: number;
  droppedLines?: number;
  details?: JsonValue;
  diagnostics?: ToolDiagnostic[];
};

export type ToolSlot = SlotProgress & {
  taskId?: TaskId;
  entry?: EntryId;
};

export type NestedToolSlot = SlotProgress & {
  parentCallId: string;
  parentTaskId: TaskId;
  taskId: TaskId;
  arguments: JsonObject;
  summary?: NestedToolSummary;
};

export type NestedToolSummary = {
  isError: boolean;
  durationMs?: number;
  usage?: JsonRepresentation<Usage>;
  error?: string;
};

export type CompactionStatus = {
  taskId: TaskId<CompactionResult>;
  reason: CompactionReason;
  blocking: boolean;
  attempt: number;
  retry?: { at: number; error: string };
};

export type CompactionFailure = {
  taskId: TaskId<CompactionResult>;
  reason: CompactionReason;
  error: string;
};

export type LiveState = {
  run?: { taskId: TaskId; inputs: SubmissionId[] };
  generation?: {
    attempt: number;
    message?: JsonRepresentation<AssistantMessage>;
    retry?: { at: number; error: string };
    deferred?: { pollAt: number };
  };
  tools?: ToolSlot[];
  nestedTools?: NestedToolSlot[];
  compactions?: CompactionStatus[];
  compactionFailure?: CompactionFailure;
};

export const LiveDoc = defineDoc<LiveState>({
  kind: "msa.live",
  version: 1,
  scope: "conversation",
  history: "latest",
  fork: "initial",
  initial: () => ({}),
  checkpointWhen: (value) =>
    value.generation === undefined &&
    !(value.tools ?? []).some((slot) => slot.status === "running") &&
    !(value.nestedTools ?? []).some((slot) => slot.status === "running"),
});

const RUN_TASK_KINDS: ReadonlySet<string> = new Set(["msa.generation"]);
const TOOL_TASK_KIND = "msa.tool";
const COMPACTION_TASK_KIND = "msa.compaction";

export const endRun: Dual4<
  Tx,
  Draft<LiveState>,
  TaskId,
  SubmissionSettlement,
  void
> = Function.dual(
  4,
  (tx: Tx, live: Draft<LiveState>, taskId: TaskId, settlement: SubmissionSettlement): void => {
    if (live.run?.taskId === taskId) {
      for (const id of live.run.inputs) tx.settleSubmission(id, settlement);
      delete live.run;
    }
    delete live.generation;
    delete live.tools;
    delete live.nestedTools;
  },
);

export const addCompactionStatus: Dual2<Draft<LiveState>, CompactionStatus, void> = Function.dual(
  2,
  (live: Draft<LiveState>, status: CompactionStatus): void => {
    live.compactions ??= [];
    live.compactions.push(status);
  },
);

export const compactionStatus: Dual2<
  Draft<LiveState>,
  TaskId,
  Draft<CompactionStatus> | undefined
> = Function.dual(
  2,
  (live: Draft<LiveState>, taskId: TaskId): Draft<CompactionStatus> | undefined =>
    live.compactions?.find((status) => status.taskId === taskId),
);

export const removeCompactionStatus: Dual2<Draft<LiveState>, TaskId, void> = Function.dual(
  2,
  (live: Draft<LiveState>, taskId: TaskId): void => {
    const statuses = live.compactions;
    if (statuses === undefined) return;
    const index = statuses.findIndex((status) => status.taskId === taskId);
    if (index >= 0) statuses.splice(index, 1);
    if (statuses.length === 0) delete live.compactions;
  },
);

export const failCompactionStatus: Dual3<Draft<LiveState>, TaskId, string, void> = Function.dual(
  3,
  (live: Draft<LiveState>, taskId: TaskId, error: string): void => {
    const status = compactionStatus(live, taskId);
    if (status !== undefined)
      live.compactionFailure = { taskId: status.taskId, reason: status.reason, error };
    removeCompactionStatus(live, taskId);
  },
);

const findNestedSlot = (
  nested: Draft<NestedToolSlot[]>,
  taskId: TaskId,
): Draft<NestedToolSlot> | undefined => {
  let low = 0;
  let high = nested.length - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    const candidate = nested[middle]!;
    if (candidate.taskId === taskId) return candidate;
    if (candidate.taskId < taskId) low = middle + 1;
    else high = middle - 1;
  }
  return undefined;
};

export const toolSlot: Dual2<
  Draft<LiveState>,
  TaskId,
  Draft<ToolSlot | NestedToolSlot> | undefined
> = Function.dual(
  2,
  (live: Draft<LiveState>, taskId: TaskId): Draft<ToolSlot | NestedToolSlot> | undefined => {
    const slot = live.tools?.find((each) => each.taskId === taskId);
    if (slot !== undefined || live.nestedTools === undefined) return slot;
    return findNestedSlot(live.nestedTools, taskId);
  },
);

export function finishSlot(slot: Draft<ToolSlot | NestedToolSlot>): void {
  slot.status = "done";
  clearProgress(slot);
}

export const removeNestedSlots: Dual2<Draft<LiveState>, TaskId, void> = Function.dual(
  2,
  (live: Draft<LiveState>, taskId: TaskId): void => {
    const nested = live.nestedTools;
    if (nested === undefined) return;
    const removed = new Set<TaskId>([taskId]);
    for (const slot of nested) if (removed.has(slot.parentTaskId)) removed.add(slot.taskId);
    for (let index = nested.length - 1; index >= 0; index--) {
      if (removed.has(nested[index]!.parentTaskId)) nested.splice(index, 1);
    }
    if (nested.length === 0) delete live.nestedTools;
  },
);

export function clearProgress(slot: Draft<SlotProgress>): void {
  delete slot.output;
  delete slot.droppedBytes;
  delete slot.droppedLines;
  delete slot.details;
  delete slot.diagnostics;
}

const settleToolOutcome = Effect.fn("settleToolOutcome")(function* (
  tx: Transaction,
  record: TaskRecord<JsonValue, JsonValue, JsonValue>,
) {
  const live = yield* Effect.promise(() => tx.doc(LiveDoc, record.conversationId));
  const slot = toolSlot(live, record.id);
  if (slot !== undefined) finishSlot(slot);
  removeNestedSlots(live, record.id);
});

const settleRunOutcome = Effect.fn("settleRunOutcome")(function* (
  tx: Transaction,
  record: TaskRecord<JsonValue, JsonValue, JsonValue>,
  outcome: SchedulerOutcome,
) {
  const live = yield* Effect.promise(() => tx.doc(LiveDoc, record.conversationId));
  if (live.run?.taskId !== record.id) return;
  yield* convertPartial(tx, live, record.conversationId);
  endRun(
    tx,
    live,
    record.id,
    outcome.status === "faulted"
      ? { status: "unanswered", reason: "faulted", detail: outcome.error.message }
      : { status: "unanswered", reason: outcome.reason },
  );
});

export const settleSchedulerOutcome: Dual3<
  Transaction,
  TaskRecord<JsonValue, JsonValue, JsonValue>,
  SchedulerOutcome,
  Effect.Effect<void>
> = Function.dual(
  3,
  Effect.fn("settleSchedulerOutcome")(function* (
    tx: Transaction,
    record: TaskRecord<JsonValue, JsonValue, JsonValue>,
    outcome: SchedulerOutcome,
  ) {
    if (record.kind === TOOL_TASK_KIND) return yield* settleToolOutcome(tx, record);
    if (record.kind === COMPACTION_TASK_KIND) {
      const error = outcome.status === "faulted" ? outcome.error.message : outcome.reason;
      const live = yield* Effect.promise(() => tx.doc(LiveDoc, record.conversationId));
      failCompactionStatus(live, record.id, error);
      return;
    }
    if (!RUN_TASK_KINDS.has(record.kind)) return;
    yield* settleRunOutcome(tx, record, outcome);
  }),
);
