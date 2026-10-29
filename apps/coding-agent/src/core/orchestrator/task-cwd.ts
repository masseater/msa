import { Effect } from "effect";

import type orchestratorTypesTypes from "./types.types.ts";
import worktreeModule from "./worktree.ts";

const { worktrees } = worktreeModule;

function requireCheckableCwd(
  label: string,
  cwd: string,
  checks: readonly orchestratorTypesTypes.TaskCheck[],
): Effect.Effect<void> {
  return Effect.gen(function* () {
    if (checks.length === 0 || (yield* worktrees.isWorkTree(cwd))) return;
    throw new Error(
      `${label} cannot have checks while its cwd ${cwd} is not a git working tree: the harness gives it no worktree there, and a check that runs git fails whatever the work does. Pass cwd as the path of a checkout of the repository the task works on.`,
    );
  });
}

const taskCwd = { requireCheckableCwd };

export default taskCwd;
