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

interface Read {
  pull: PullView | undefined;
  unread?: Omit<orchestratorTypesTypes.UnreadPullRequest, "taskId"> | undefined;
}

function readCurrent(
  runtime: runtimeTypes.Runtime,
  task: orchestratorTypesTypes.Task,
  recorded: PullRequest | undefined,
): Effect.Effect<Read> {
  return Effect.gen(function* () {
    let unread: Read["unread"];
    const owner = yield* pullRequests.ownerOf(runtime, task);
    if (owner !== undefined) {
      if (heldByAnother(runtime, task.id, owner.branch)) return { pull: undefined };
      const found = yield* Effect.result(pullRequests.current(runtime, owner));
      if (Result.isSuccess(found) && found.success !== undefined) return { pull: found.success };
      if (Result.isFailure(found)) {
        unread = { branch: owner.branch, error: found.failure.message };
      }
    }
    if (recorded === undefined || recorded.state !== "OPEN") return { pull: undefined, unread };
    const viewed = yield* Effect.result(pullRequests.view(runtime, task.cwd, recorded.number));
    if (Result.isFailure(viewed) || viewed.success.headRefName !== recorded.branch) {
      return { pull: undefined };
    }
    return { pull: viewed.success };
  });
}

const inPlace: runtimeTypes.Write = (effect) => effect;

function refreshWhen(
  runtime: runtimeTypes.Runtime,
  taskId: string,
  wanted: (pull: PullView) => boolean,
  write: runtimeTypes.Write = inPlace,
): Effect.Effect<{ record: PullRequest | undefined; unread: Read["unread"] }> {
  return Effect.gen(function* () {
    const task = store.getTask(runtime.database, taskId);
    if (task === undefined) return { record: undefined, unread: undefined };
    const recorded = store.pullRequestOf(runtime.database, task.id);
    const { pull, unread } = yield* readCurrent(runtime, task, recorded);
    if (pull === undefined || !wanted(pull)) return { record: recorded, unread };
    const verified = recorded?.number === pull.number ? recorded.verified : null;
    const now = yield* nowMillis;
    const record = yield* write(
      Effect.sync(() => pullRequests.save(runtime, task.id, pull, verified, now, true)),
    );
    return { record, unread: undefined };
  });
}

function refresh(
  runtime: runtimeTypes.Runtime,
  taskId: string,
  write: runtimeTypes.Write = inPlace,
): Effect.Effect<PullRequest | undefined> {
  return Effect.map(
    refreshWhen(runtime, taskId, () => true, write),
    (read) => read.record,
  );
}

function refreshOrUnread(
  runtime: runtimeTypes.Runtime,
  taskId: string,
): Effect.Effect<orchestratorTypesTypes.UnreadPullRequest | undefined> {
  return Effect.map(
    refreshWhen(runtime, taskId, () => true),
    ({ unread }) => (unread === undefined ? undefined : { ...unread, taskId }),
  );
}

function refreshEnd(
  runtime: runtimeTypes.Runtime,
  taskId: string,
  write: runtimeTypes.Write = inPlace,
): Effect.Effect<PullRequest | undefined> {
  return Effect.map(
    refreshWhen(runtime, taskId, (pull) => pull.state.toUpperCase() !== "OPEN", write),
    (read) => read.record,
  );
}

const pullRequestRefresh = { refresh, refreshEnd, refreshOrUnread };

export default pullRequestRefresh;
