import { Effect, Result } from "effect";

import type goalCheckTextTypes from "./goal-check-text.types.ts";
import pullRequestsModule from "./pull-requests.ts";
import runtimeModule from "./runtime.ts";
import type runtimeTypes from "./runtime.types.ts";
import type orchestratorTypesTypes from "./types.types.ts";
import worktreeModule from "./worktree.ts";

const { pullRequests } = pullRequestsModule;
const { worktrees } = worktreeModule;
const { nowMillis } = runtimeModule;

type GateResult = goalCheckTextTypes.GateResult;

function check(
  runtime: runtimeTypes.Runtime,
  task: orchestratorTypesTypes.Task,
): Effect.Effect<GateResult | undefined> {
  return Effect.gen(function* () {
    const owner = yield* pullRequests.ownerOf(runtime, task);
    if (owner === undefined) return undefined;
    const found = yield* Effect.result(pullRequests.current(runtime, owner));
    if (Result.isFailure(found)) {
      return {
        number: null,
        problems: [`Could not read the pull request of ${owner.branch}: ${found.failure.message}`],
        task,
      };
    }
    const pull = found.success;
    if (pull === undefined) {
      return {
        number: null,
        problems: [
          `No pull request has ${owner.branch} as its head. Push ${owner.branch} and open a pull request into ${owner.base}.`,
        ],
        task,
      };
    }
    const now = yield* nowMillis;
    const local = yield* worktrees.headOf(owner.cwd);
    const unverified = pullRequests.save(runtime, task.id, pull, null, now);
    const problems = pullRequests.problemsOf(unverified, local);
    if (problems.length === 0) pullRequests.save(runtime, task.id, pull, pull.headRefOid, now);
    return { number: unverified.number, problems, task };
  });
}

const pullRequestGate = { check };

const pullRequestGateModule = { pullRequestGate };

export default pullRequestGateModule;
