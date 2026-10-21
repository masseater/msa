import type chordTypes from "@msa/chord/index.types";
import { Function } from "effect";

import documents from "../documents.ts";
import type liveTypes from "./live.types.ts";
import type typesModule from "./types.types.ts";

const { defineDoc } = documents;

const LiveDoc = defineDoc<liveTypes.LiveState>({
  checkpointWhen: (value) =>
    value.generation === undefined &&
    !(value.tools ?? []).some((slot) => slot.status === "running") &&
    !(value.nestedTools ?? []).some((slot) => slot.status === "running"),
  fork: "initial",
  history: "latest",
  initial: () => ({}),
  kind: "msa.live",
  scope: "conversation",
  version: 1,
});

const endRun: typesModule.Dual4<
  typesModule.Tx,
  chordTypes.Draft<liveTypes.LiveState>,
  typesModule.TaskId,
  typesModule.SubmissionSettlement,
  void
> = Function.dual(
  4,
  (
    tx: typesModule.Tx,
    live: chordTypes.Draft<liveTypes.LiveState>,
    taskId: typesModule.TaskId,
    settlement: typesModule.SubmissionSettlement,
  ): void => {
    if (live.run?.taskId === taskId) {
      for (const id of live.run.inputs) tx.settleSubmission(id, settlement);
      delete live.run;
    }
    delete live.generation;
    delete live.tools;
    delete live.nestedTools;
  },
);

const addCompactionStatus: typesModule.Dual2<
  chordTypes.Draft<liveTypes.LiveState>,
  liveTypes.CompactionStatus,
  void
> = Function.dual(
  2,
  (live: chordTypes.Draft<liveTypes.LiveState>, status: liveTypes.CompactionStatus): void => {
    live.compactions ??= [];
    live.compactions.push(status);
  },
);

const compactionStatus: typesModule.Dual2<
  chordTypes.Draft<liveTypes.LiveState>,
  typesModule.TaskId,
  chordTypes.Draft<liveTypes.CompactionStatus> | undefined
> = Function.dual(
  2,
  (
    live: chordTypes.Draft<liveTypes.LiveState>,
    taskId: typesModule.TaskId,
  ): chordTypes.Draft<liveTypes.CompactionStatus> | undefined =>
    live.compactions?.find((status) => status.taskId === taskId),
);

const removeCompactionStatus: typesModule.Dual2<
  chordTypes.Draft<liveTypes.LiveState>,
  typesModule.TaskId,
  void
> = Function.dual(
  2,
  (live: chordTypes.Draft<liveTypes.LiveState>, taskId: typesModule.TaskId): void => {
    const statuses = live.compactions;
    if (statuses === undefined) return;
    const index = statuses.findIndex((status) => status.taskId === taskId);
    if (index >= 0) statuses.splice(index, 1);
    if (statuses.length === 0) delete live.compactions;
  },
);

const failCompactionStatus: typesModule.Dual3<
  chordTypes.Draft<liveTypes.LiveState>,
  typesModule.TaskId,
  string,
  void
> = Function.dual(
  3,
  (
    live: chordTypes.Draft<liveTypes.LiveState>,
    taskId: typesModule.TaskId,
    error: string,
  ): void => {
    const status = compactionStatus(live, taskId);
    if (status !== undefined)
      live.compactionFailure = { error, reason: status.reason, taskId: status.taskId };
    removeCompactionStatus(live, taskId);
  },
);

const findNestedSlot = (
  nested: chordTypes.Draft<liveTypes.NestedToolSlot[]>,
  taskId: typesModule.TaskId,
): chordTypes.Draft<liveTypes.NestedToolSlot> | undefined => {
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

const toolSlot: typesModule.Dual2<
  chordTypes.Draft<liveTypes.LiveState>,
  typesModule.TaskId,
  chordTypes.Draft<liveTypes.ToolSlot | liveTypes.NestedToolSlot> | undefined
> = Function.dual(
  2,
  (
    live: chordTypes.Draft<liveTypes.LiveState>,
    taskId: typesModule.TaskId,
  ): chordTypes.Draft<liveTypes.ToolSlot | liveTypes.NestedToolSlot> | undefined => {
    const slot = live.tools?.find((each) => each.taskId === taskId);
    if (slot !== undefined || live.nestedTools === undefined) return slot;
    return findNestedSlot(live.nestedTools, taskId);
  },
);

function finishSlot(slot: chordTypes.Draft<liveTypes.ToolSlot | liveTypes.NestedToolSlot>): void {
  slot.status = "done";
  clearProgress(slot);
}

const removeNestedSlots: typesModule.Dual2<
  chordTypes.Draft<liveTypes.LiveState>,
  typesModule.TaskId,
  void
> = Function.dual(
  2,
  (live: chordTypes.Draft<liveTypes.LiveState>, taskId: typesModule.TaskId): void => {
    const nested = live.nestedTools;
    if (nested === undefined) return;
    const removed = new Set<typesModule.TaskId>([taskId]);
    for (const slot of nested) if (removed.has(slot.parentTaskId)) removed.add(slot.taskId);
    for (let index = nested.length - 1; index >= 0; index--) {
      if (removed.has(nested[index]!.parentTaskId)) nested.splice(index, 1);
    }
    if (nested.length === 0) delete live.nestedTools;
  },
);

function clearProgress(slot: chordTypes.Draft<liveTypes.SlotProgress>): void {
  delete slot.output;
  delete slot.droppedBytes;
  delete slot.droppedLines;
  delete slot.details;
  delete slot.diagnostics;
}

const liveModule = {
  LiveDoc,
  addCompactionStatus,
  clearProgress,
  compactionStatus,
  endRun,
  failCompactionStatus,
  finishSlot,
  removeCompactionStatus,
  removeNestedSlots,
  toolSlot,
};

export default liveModule;
