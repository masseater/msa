import type runtimeTypes from "./runtime.types.ts";
import storeModule from "./store.ts";
import type orchestratorTypesTypes from "./types.types.ts";

const { store } = storeModule;

interface Handover {
  handedOver: orchestratorTypesTypes.PullRequestHandover[];
  orphaned: orchestratorTypesTypes.OrphanedPullRequest[];
}

function heirOf(
  runtime: runtimeTypes.Runtime,
  candidates: readonly string[],
): orchestratorTypesTypes.Task | undefined {
  return candidates
    .flatMap((id) => store.getTask(runtime.database, id) ?? [])
    .find(
      (task) =>
        task.mergeInto === null && store.pullRequestOf(runtime.database, task.id) === undefined,
    );
}

function handOver(
  runtime: runtimeTypes.Runtime,
  closed: readonly string[],
  inheritors: ReadonlyMap<string, readonly string[]>,
): Handover {
  const handover: Handover = { handedOver: [], orphaned: [] };
  for (const taskId of closed) {
    const pull = store.pullRequestOf(runtime.database, taskId);
    if (pull === undefined || pull.state !== "OPEN") continue;
    const heir = heirOf(runtime, inheritors.get(taskId) ?? []);
    if (heir === undefined) {
      handover.orphaned.push({ branch: pull.branch, number: pull.number, taskId, url: pull.url });
      continue;
    }
    store.movePullRequest(runtime.database, taskId, heir.id);
    handover.handedOver.push({ from: taskId, number: pull.number, to: heir.id });
  }
  return handover;
}

const pullRequestHandover = { handOver };

export default pullRequestHandover;
