import { Effect } from "effect";

import type goalCheckTextTypes from "./goal-check-text.types.ts";
import pullRequestGateModule from "./pull-request-gate.ts";
import pullRequestsModule from "./pull-requests.ts";
import type runtimeTypes from "./runtime.types.ts";
import storeModule from "./store.ts";
import text from "./text.ts";
import type orchestratorTypesTypes from "./types.types.ts";

const { store } = storeModule;
const { outputPattern } = text;
const { pullRequestGate } = pullRequestGateModule;
const { ciTiming } = pullRequestsModule.pullRequests;

const CHECK_TIMEOUT_MS = 10 * 60_000;

type CheckResult = goalCheckTextTypes.CheckResult;
type Verification = goalCheckTextTypes.Verification;

function runCheck(
  runtime: runtimeTypes.Runtime,
  check: orchestratorTypesTypes.TaskCheck,
  cwd: string,
): Effect.Effect<CheckResult> {
  return Effect.promise((signal) =>
    runtime.options.runCommand(check.command, cwd, CHECK_TIMEOUT_MS, signal),
  ).pipe(
    Effect.map((result) => ({
      check,
      exitCode: result.exitCode,
      output: result.output,
      passed:
        result.exitCode === check.exitCode &&
        (check.output === null || outputPattern(check.output).test(result.output)),
    })),
  );
}

function workerTasks(
  runtime: runtimeTypes.Runtime,
  threadId: string,
): orchestratorTypesTypes.Task[] {
  return store
    .assignmentsOfThread(runtime.database, threadId)
    .filter((assignment) => assignment.role === "worker")
    .flatMap((assignment) => store.getTask(runtime.database, assignment.taskId) ?? []);
}

function verifyAll(
  runtime: runtimeTypes.Runtime,
  threadId: string,
  tasks: readonly orchestratorTypesTypes.Task[],
  live: () => boolean,
): Effect.Effect<Verification> {
  return Effect.gen(function* () {
    const checks = yield* runAll(
      runtime,
      threadId,
      tasks.filter((task) => task.checks.length > 0),
    );
    const gates = yield* Effect.forEach(tasks, (task) =>
      pullRequestGate.check(runtime, task, live),
    );
    return { checks, pullRequests: gates.flatMap((gate) => gate ?? []) };
  });
}

function runAll(
  runtime: runtimeTypes.Runtime,
  threadId: string,
  tasks: readonly orchestratorTypesTypes.Task[],
): Effect.Effect<CheckResult[]> {
  const cwd = store.getThread(runtime.database, threadId)?.cwd;
  return Effect.forEach(
    tasks.flatMap((task) => task.checks.map((check) => ({ check, cwd: cwd ?? task.cwd }))),
    (planned) => runCheck(runtime, planned.check, planned.cwd),
  );
}

const goalCheckRun = { ciTiming, verifyAll, workerTasks };

export default goalCheckRun;
