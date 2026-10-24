import { Effect, Result } from "effect";

import pullRequestsModule from "./pull-requests.ts";
import runtimeModule from "./runtime.ts";
import type runtimeTypes from "./runtime.types.ts";
import storeModule from "./store.ts";
import type orchestratorTypesTypes from "./types.types.ts";
import worktreeModule from "./worktree.ts";

const { pullRequests } = pullRequestsModule;
const { worktrees } = worktreeModule;
const { store } = storeModule;
const { nowMillis } = runtimeModule;

type MergeOutcome = runtimeTypes.MergeOutcome;

function sendBack(problems: readonly string[], number: number | null): MergeOutcome {
  const name = number === null ? "the pull request" : `PR #${number}`;
  return {
    kind: "sent-back",
    line: `The review passed, but the harness cannot merge ${name} yet, so the task goes back to the worker: ${problems.join(" ")}`,
    prompt: [
      "<merge-blocked>",
      `The reviewer passed this work, but the harness could not merge ${name}. Fix the following; the work is checked and reviewed again after them.`,
      ...problems.map((problem) => `- ${problem}`),
      "</merge-blocked>",
    ].join("\n"),
  };
}

function finish(
  runtime: runtimeTypes.Runtime,
  task: orchestratorTypesTypes.Task,
  record: orchestratorTypesTypes.PullRequest,
  merged: string,
): Effect.Effect<MergeOutcome> {
  return Effect.gen(function* () {
    const removed = yield* worktrees.cleanUp(runtime, task, record.branch);
    const cleaned = removed.length === 0 ? "" : ` Removed ${removed.join(", ")}.`;
    return { kind: "merged", line: `${merged}${cleaned}` };
  });
}

interface Ready {
  owner: { branch: string; base: string; cwd: string };
  record: orchestratorTypesTypes.PullRequest;
  verified: string;
}

function squash(
  runtime: runtimeTypes.Runtime,
  task: orchestratorTypesTypes.Task,
  ready: Ready,
): Effect.Effect<MergeOutcome> {
  return Effect.gen(function* () {
    const { owner, record, verified } = ready;
    const merging = yield* Effect.result(
      pullRequests.merge(runtime, owner.cwd, record.number, verified),
    );
    const after = yield* Effect.result(pullRequests.view(runtime, owner.cwd, record.number));
    if (Result.isSuccess(after) && after.success.state.toUpperCase() === "MERGED") {
      const merged = pullRequests.save(runtime, task.id, after.success, verified, yield* nowMillis);
      return yield* finish(
        runtime,
        task,
        merged,
        `Squash-merged PR #${merged.number} at head ${pullRequests.short(verified)}.`,
      );
    }
    const why = Result.isFailure(merging)
      ? merging.failure.message
      : Result.isFailure(after)
        ? after.failure.message
        : `#${record.number} is still ${after.success.state.toLowerCase()}`;
    return {
      kind: "stopped",
      line: `The review passed, but the harness could not merge PR #${record.number}, so the task is stopped, not completed: ${why}`,
    };
  });
}

function blocked(
  record: orchestratorTypesTypes.PullRequest,
  verified: string | null,
): MergeOutcome | undefined {
  const problems = pullRequests.problemsOf(record, undefined);
  if (problems.length > 0) return sendBack(problems, record.number);
  if (verified !== null && verified === record.headSha) return undefined;
  return sendBack(
    [
      `The head of #${record.number} is ${pullRequests.short(record.headSha)}, not the commit the goal check passed and the reviewer read${verified === null ? "" : ` (${pullRequests.short(verified)})`}. End your turn again so the new head is checked and reviewed.`,
    ],
    record.number,
  );
}

function afterReview(
  runtime: runtimeTypes.Runtime,
  task: orchestratorTypesTypes.Task,
): Effect.Effect<MergeOutcome | undefined> {
  return Effect.gen(function* () {
    const owner = yield* pullRequests.ownerOf(runtime, task);
    if (owner === undefined) return undefined;
    const recorded = store.pullRequestOf(runtime.database, task.id);
    const found = yield* Effect.result(pullRequests.current(runtime, owner));
    if (Result.isFailure(found)) {
      return {
        kind: "stopped",
        line: `The review passed, but the harness could not read the pull request of ${owner.branch}, so the task is stopped, not completed: ${found.failure.message}`,
      };
    }
    const pull = found.success;
    if (pull === undefined) {
      return sendBack(
        [
          `No pull request has ${owner.branch} as its head. Push it and open one into ${owner.base}.`,
        ],
        null,
      );
    }
    const verified = recorded?.number === pull.number ? recorded.verifiedSha : null;
    const record = pullRequests.save(runtime, task.id, pull, verified, yield* nowMillis);
    if (record.state === "MERGED") {
      return yield* finish(runtime, task, record, `PR #${record.number} was already merged.`);
    }
    const stop = blocked(record, verified);
    if (stop !== undefined || verified === null) return stop;
    return yield* squash(runtime, task, { owner, record, verified });
  });
}

const pullRequestMerge = { afterReview };

const pullRequestMergeModule = { pullRequestMerge };

export default pullRequestMergeModule;
