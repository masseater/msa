import { Effect, Result } from "effect";

import pullRequestsModule from "./pull-requests.ts";
import runtimeModule from "./runtime.ts";
import type runtimeTypes from "./runtime.types.ts";
import storeModule from "./store.ts";
import type orchestratorTypesTypes from "./types.types.ts";

const { pullRequests } = pullRequestsModule;
const { nowMillis } = runtimeModule;
const { store } = storeModule;

type PullView = Parameters<typeof pullRequests.verifiedOf>[0];
type PullRequest = orchestratorTypesTypes.PullRequest;

function heldByAnother(runtime: runtimeTypes.Runtime, taskId: string, branch: string): boolean {
  return store
    .listPullRequests(runtime.database, runtime.options.project)
    .some((pull) => pull.branch === branch && pull.taskId !== taskId);
}

function readCurrent(
  runtime: runtimeTypes.Runtime,
  task: orchestratorTypesTypes.Task,
  recorded: PullRequest | undefined,
): Effect.Effect<PullView | undefined> {
  return Effect.gen(function* () {
    const owner = yield* pullRequests.ownerOf(runtime, task);
    if (owner !== undefined) {
      if (heldByAnother(runtime, task.id, owner.branch)) return undefined;
      const found = yield* Effect.result(pullRequests.current(runtime, owner));
      if (Result.isSuccess(found) && found.success !== undefined) return found.success;
    }
    if (recorded === undefined || recorded.state !== "OPEN") return undefined;
    const viewed = yield* Effect.result(pullRequests.view(runtime, task.cwd, recorded.number));
    if (Result.isFailure(viewed) || viewed.success.headRefName !== recorded.branch) {
      return undefined;
    }
    return viewed.success;
  });
}

const inPlace: runtimeTypes.Write = (effect) => effect;

function refreshWhen(
  runtime: runtimeTypes.Runtime,
  taskId: string,
  wanted: (pull: PullView) => boolean,
  write: runtimeTypes.Write = inPlace,
): Effect.Effect<PullRequest | undefined> {
  return Effect.gen(function* () {
    const task = store.getTask(runtime.database, taskId);
    if (task === undefined) return undefined;
    const recorded = store.pullRequestOf(runtime.database, task.id);
    const pull = yield* readCurrent(runtime, task, recorded);
    if (pull === undefined || !wanted(pull)) return recorded;
    const verified = recorded?.number === pull.number ? recorded.verified : null;
    const now = yield* nowMillis;
    return yield* write(
      Effect.sync(() => pullRequests.save(runtime, task.id, pull, verified, now, true)),
    );
  });
}

function refresh(
  runtime: runtimeTypes.Runtime,
  taskId: string,
  write: runtimeTypes.Write = inPlace,
): Effect.Effect<PullRequest | undefined> {
  return refreshWhen(runtime, taskId, () => true, write);
}

function refreshEnd(
  runtime: runtimeTypes.Runtime,
  taskId: string,
  write: runtimeTypes.Write = inPlace,
): Effect.Effect<PullRequest | undefined> {
  return refreshWhen(runtime, taskId, (pull) => pull.state.toUpperCase() !== "OPEN", write);
}

const pullRequestRefresh = { refresh, refreshEnd };

export default pullRequestRefresh;
