import type replanApplyInternalTypes from "./replan-apply-internal.types.ts";
import replanApplyPart1 from "./replan-apply-part1.ts";
import replanApplyPart2 from "./replan-apply-part2.ts";
import replanStoreModule from "./replan-store.ts";
import type replanTypes from "./replan.types.ts";
import type runtimeTypes from "./runtime.types.ts";
import storeModule from "./store.ts";
import type orchestratorTypesTypes from "./types.types.ts";

const { store } = storeModule;
const { replanStore } = replanStoreModule;
const { closeDropped } = replanApplyPart1;
const { createTasks, keep, rewire, writeHandoffs } = replanApplyPart2;

function write(
  runtime: runtimeTypes.Runtime,
  prepared: replanTypes.Prepared,
  handoffs: readonly replanApplyInternalTypes.Handoff[],
  replanId: string,
  now: number,
): orchestratorTypesTypes.ReplanChanges {
  const database = runtime.database;
  const project = runtime.options.project;
  return store.transaction(database, () => {
    const dropped = closeDropped(runtime, prepared, replanId, now);
    const creation = createTasks(runtime, prepared, now);
    const rewired = rewire(runtime, prepared, creation.byKey);
    keep(runtime, prepared, now);
    if (prepared.input.maxConcurrentThreads !== undefined) {
      store.storeMaxConcurrent(database, project, prepared.input.maxConcurrentThreads);
      runtime.maxConcurrentThreads = prepared.input.maxConcurrentThreads;
    }
    writeHandoffs(runtime, prepared, handoffs, replanId, now, creation.inheritors);
    const stopped: orchestratorTypesTypes.ReplanStopped[] = handoffs.map((handoff) => ({
      memo: handoff.memo,
      taskId: handoff.taskId,
      threadId: handoff.threadId,
      title: handoff.title,
    }));
    const changes: orchestratorTypesTypes.ReplanChanges = {
      created: creation.created,
      dropped,
      kept: prepared.keep,
      rewired,
      stopped,
    };
    replanStore.insertReplan(database, {
      after: changes,
      createdAt: now,
      id: replanId,
      project,
      reason: prepared.input.reason,
    });
    return changes;
  });
}

const replanApplyPart3 = {
  write,
};

export default replanApplyPart3;
