import { Effect, Schema } from "effect";

import type orchestratorTypesTypes from "./types.types.ts";
import UncheckableCwd from "./uncheckable-cwd.ts";
import worktreeGit from "./worktree-git.ts";

const PASS_A_CHECKOUT = "Pass cwd as the path of a checkout of the repository the task works on.";

function requireCheckable(
  label: string,
  cwd: string,
  checks: readonly orchestratorTypesTypes.TaskCheck[],
  remedy: string,
): Effect.Effect<void, UncheckableCwd> {
  return Effect.gen(function* () {
    if (checks.length === 0 || (yield* worktreeGit.isWorkTree(cwd))) return;
    return yield* UncheckableCwd.make({
      message: `${label} cannot have checks while its cwd ${cwd} is not a git working tree: the harness gives it no worktree there, and a check that runs git fails whatever the work does. ${remedy}`,
    });
  });
}

function requireStartable(task: orchestratorTypesTypes.Task): Effect.Effect<void, UncheckableCwd> {
  return requireCheckable(
    `Task ${task.id} (${task.title})`,
    task.cwd,
    task.checks,
    `The harness did not start it and stopped the task. Replan with ${task.id} in from and cwd as the path of a checkout of the repository it works on; the new task keeps these checks.`,
  );
}

function setStateRemedy(taskId: string): string {
  return `set_task_state cannot change a task's cwd: replan with ${taskId} in from and cwd as the path of a checkout of the repository it works on, and give the checks there.`;
}

function requireCheckableCwd(
  label: string,
  cwd: string,
  checks: readonly orchestratorTypesTypes.TaskCheck[],
  remedy = PASS_A_CHECKOUT,
): Effect.Effect<void> {
  return requireCheckable(label, cwd, checks, remedy).pipe(
    Effect.catchTag("UncheckableCwd", (refused) =>
      Effect.sync(() => {
        throw new Error(refused.message);
      }),
    ),
  );
}

const isUncheckable = Schema.is(UncheckableCwd);

const taskCwd = { isUncheckable, requireCheckableCwd, requireStartable, setStateRemedy };

export default taskCwd;
