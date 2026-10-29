import { Effect } from "effect";

import actionHelpersModule from "./action-helpers.ts";
import runtimeModule from "./runtime.ts";
import type runtimeTypes from "./runtime.types.ts";
import storeModule from "./store.ts";
import taskCwd from "./task-cwd.ts";
import text from "./text.ts";
import type orchestratorTypesTypes from "./types.types.ts";

const { nowMillis } = runtimeModule;
const { store } = storeModule;
const { requireChecks, requireStates } = text;
const { requireCheckableCwd } = taskCwd;
const { actionHelpers } = actionHelpersModule;
const { taskOf } = actionHelpers;

function setState(runtime: runtimeTypes.Runtime, input: orchestratorTypesTypes.SetTaskStateInput) {
  return Effect.gen(function* () {
    const now = yield* nowMillis;
    if (
      input.currentState === undefined &&
      input.goalState === undefined &&
      input.checks === undefined
    ) {
      throw new Error("Pass the current state, the goal state, the checks, or several of them");
    }
    const task = yield* Effect.sync(() => taskOf(runtime, input.taskId, "taskId"));
    if (task.kind === "review") {
      throw new Error(`${task.id} is a round review; its states come from the round`);
    }
    if (task.status === "running") {
      throw new Error(
        `${task.id} is running. Stop it with stop_task before rewriting its states, or send_message to steer it now.`,
      );
    }
    const states = requireStates(
      `Task ${task.id}`,
      input.currentState ?? task.currentState,
      input.goalState ?? task.goalState,
    );
    const checks =
      input.checks === undefined ? task.checks : requireChecks(`Task ${task.id}`, input.checks);
    if (input.checks !== undefined) yield* requireCheckableCwd(`Task ${task.id}`, task.cwd, checks);
    yield* Effect.sync(() =>
      store.updateTask(runtime.database, task.id, { ...states, checks }, now),
    );
    yield* Effect.sync(() => runtime.publish());
    return actionHelpers.taskView(runtime, task.id);
  });
}

const taskStateEdit = { setState };

export default taskStateEdit;
