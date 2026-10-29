import { Effect, Result } from "effect";

import type goalCheckTextTypes from "./goal-check-text.types.ts";
import noPullRequestModule from "./no-pull-request.ts";
import pullRequestOutside from "./pull-request-outside.ts";
import pullRequestProblems from "./pull-request-problems.ts";
import pullRequestsModule from "./pull-requests.ts";
import runtimeModule from "./runtime.ts";
import type runtimeTypes from "./runtime.types.ts";
import type orchestratorTypesTypes from "./types.types.ts";
import worktreeModule from "./worktree.ts";

const { pullRequests } = pullRequestsModule;
const { noPullRequest } = noPullRequestModule;
const { problemsOf } = pullRequestProblems;
const { outsideLine } = pullRequestOutside;
const { worktrees } = worktreeModule;
const { nowMillis } = runtimeModule;

type GateResult = goalCheckTextTypes.GateResult;

function missing(
  task: orchestratorTypesTypes.Task,
  owner: { branch: string; base: string },
): GateResult {
  return {
    number: null,
    problems: [
      {
        kind: "fix",
        text: `No pull request has ${owner.branch} as its head. Push ${owner.branch} and open a pull request into ${owner.base}.`,
      },
    ],
    task,
  };
}

function check(
  runtime: runtimeTypes.Runtime,
  task: orchestratorTypesTypes.Task,
  live: () => boolean,
): Effect.Effect<GateResult | undefined> {
  return Effect.gen(function* () {
    if (!task.opensPullRequest) return yield* noPullRequest.gate(runtime, task, live);
    const owner = yield* pullRequests.ownerOf(runtime, task);
    if (owner === undefined) return undefined;
    const found = yield* Effect.result(pullRequests.current(runtime, owner));
    if (Result.isFailure(found)) {
      return {
        number: null,
        problems: [],
        stop: `The harness cannot read the pull request of ${owner.branch} with gh, so it cannot check, review, or merge this task: ${found.failure.message}. Install gh, run gh auth login, or point origin at GitHub, then rerun the task.`,
        task,
      };
    }
    const pull = found.success;
    if (pull === undefined) return missing(task, owner);
    const now = yield* nowMillis;
    const local = yield* worktrees.headOf(owner.cwd);
    if (!live()) return undefined;
    const unverified = pullRequests.save(runtime, task.id, pull, null, now);
    const autoMergeBy = pullRequests.autoMergeBy(pull);
    const stop = yield* outsideLine(runtime, task, owner.cwd, unverified, autoMergeBy);
    if (stop !== undefined) return { number: unverified.number, problems: [], stop, task };
    const problems = problemsOf(
      unverified,
      local,
      pullRequests.awaitingChecks(runtime, unverified, now),
    );
    if (problems.length === 0) {
      pullRequests.save(runtime, task.id, pull, pullRequests.verifiedOf(pull), now);
    }
    return { number: unverified.number, problems, task };
  });
}

const pullRequestGate = { check };

const pullRequestGateModule = { pullRequestGate };

export default pullRequestGateModule;
