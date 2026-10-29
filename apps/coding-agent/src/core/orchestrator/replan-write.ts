import pullRequestHandover from "./pull-request-handover.ts";
import type replanApplyInternalTypes from "./replan-apply-internal.types.ts";
import replanHandoffs from "./replan-handoffs.ts";
import replanStoreModule from "./replan-store.ts";
import replanTasks from "./replan-tasks.ts";
import type replanTypes from "./replan.types.ts";
import type runtimeTypes from "./runtime.types.ts";
import storeModule from "./store.ts";
import type orchestratorTypesTypes from "./types.types.ts";

const { replanStore } = replanStoreModule;
const { store } = storeModule;
const { writeHandoffs } = replanHandoffs;
const { keep, rewire, createTasks, closeDropped, redirectDependents } = replanTasks;

function relinkMerges(
  runtime: runtimeTypes.Runtime,
  prepared: replanTypes.Prepared,
  inheritors: ReadonlyMap<string, readonly string[]>,
  now: number,
): void {
  const database = runtime.database;
  const project = runtime.options.project;
  const replaced = new Map<string, string>();
  for (const [source, tasks] of inheritors) {
    const heir = tasks.find((id) => store.getTask(database, id)?.opensPullRequest === true);
    if (heir !== undefined) replaced.set(source, heir);
  }
  store.unlinkMergeSources(database, [
    ...prepared.sources,
    ...prepared.drop.map((item) => item.taskId),
  ]);
  store.retargetMerges(database, project, replaced, now);
  store.linkAllMergeSources(database, project);
}

function write(
  runtime: runtimeTypes.Runtime,
  prepared: replanTypes.Prepared,
  handoffs: readonly replanApplyInternalTypes.Handoff[],
  replanId: string,
  now: number,
): {
  changes: orchestratorTypesTypes.ReplanChanges;
  handover: ReturnType<typeof pullRequestHandover.handOver>;
} {
  const database = runtime.database;
  const project = runtime.options.project;
  return store.transaction(database, () => {
    const dropped = closeDropped(runtime, prepared, replanId, now);
    const creation = createTasks(runtime, prepared, now);
    const rewired = [
      ...rewire(runtime, prepared, creation.byKey),
      ...redirectDependents(runtime, prepared, creation.inheritors),
    ];
    keep(runtime, prepared, now);
    relinkMerges(runtime, prepared, creation.inheritors, now);
    const handover = pullRequestHandover.handOver(runtime, prepared.sources, creation.inheritors);
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
    return { changes, handover };
  });
}

const replanWrite = { write };

export default replanWrite;
