import { Effect } from "effect";

import type runtimeTypes from "./runtime.types.ts";
import storeModule from "./store.ts";
import worktreeSnapshot from "./worktree-snapshot.ts";
import type worktreeSnapshotTypes from "./worktree-snapshot.types.ts";

const { store } = storeModule;

type Contents = worktreeSnapshotTypes.Snapshot | undefined;

interface Failure {
  output: string;
  contents: Contents;
}

const lastFailures = new WeakMap<runtimeTypes.WorkerSession, Failure>();

function contentsOf(runtime: runtimeTypes.Runtime, threadId: string): Effect.Effect<Contents> {
  return Effect.gen(function* () {
    const cwd = store.getThread(runtime.database, threadId)?.cwd;
    return cwd === undefined ? undefined : yield* worktreeSnapshot.take(cwd);
  });
}

function failedWithoutMoving(
  worker: runtimeTypes.WorkerSession,
  output: string,
  contents: Contents,
): boolean {
  const previous = lastFailures.get(worker);
  if (previous?.output === output && worktreeSnapshot.same(previous.contents, contents)) {
    lastFailures.delete(worker);
    return true;
  }
  lastFailures.set(worker, { contents, output });
  return false;
}

function forget(worker: runtimeTypes.WorkerSession): void {
  lastFailures.delete(worker);
}

interface ReviewProgress {
  unchanged: boolean;
  diff: string;
}

function sinceLastReview(
  runtime: runtimeTypes.Runtime,
  taskId: string,
  threadId: string,
): Effect.Effect<ReviewProgress> {
  return Effect.gen(function* () {
    const contents = yield* contentsOf(runtime, threadId);
    const previous = store.reviewContentsOf(runtime.database, taskId);
    store.saveReviewContents(runtime.database, taskId, contents);
    if (previous === undefined) {
      return { diff: "(no earlier review to compare with)", unchanged: false };
    }
    return {
      diff: yield* worktreeSnapshot.diff(previous, contents),
      unchanged: worktreeSnapshot.same(previous, contents),
    };
  });
}

const workProgress = { contentsOf, failedWithoutMoving, forget, sinceLastReview };

export default workProgress;
