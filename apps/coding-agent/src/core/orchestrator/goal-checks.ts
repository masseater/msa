import { Effect } from "effect";

import html from "../../utils/html.ts";
import outcomeModule from "./outcome.ts";
import promptsModule from "./prompts.ts";
import type runtimeTypes from "./runtime.types.ts";
import storeModule from "./store.ts";
import text from "./text.ts";
import threadRun from "./thread-run.ts";
import type threadRunTypes from "./thread-run.types.ts";
import type orchestratorTypesTypes from "./types.types.ts";

const { store } = storeModule;
const { outcomes } = outcomeModule;
const { prompts } = promptsModule;
const { outputPattern } = text;
const { escapeXml } = html;
const { threadRuns } = threadRun;
const { MAX_REJECTIONS } = threadRuns;

const CHECK_TIMEOUT_MS = 10 * 60_000;
const OUTPUT_LIMIT = 3000;

interface CheckResult {
  check: orchestratorTypesTypes.TaskCheck;
  exitCode: number | null;
  output: string;
  passed: boolean;
}

const rejections = new WeakMap<runtimeTypes.WorkerSession, number>();

function clip(output: string): string {
  return output.length <= OUTPUT_LIMIT ? output : `[…]\n${output.slice(-OUTPUT_LIMIT)}`;
}

function resultsText(results: readonly CheckResult[]): string {
  return results
    .map((result) => {
      const got = result.exitCode === null ? "no exit code" : `exit ${result.exitCode}`;
      return [
        `<check command="${escapeXml(result.check.command)}" expected="${escapeXml(prompts.checkExpectation(result.check))}" got="${got}" passed="${result.passed}">`,
        escapeXml(clip(result.output.trim())),
        "</check>",
      ].join("\n");
    })
    .join("\n");
}

function rejectionPrompt(results: readonly CheckResult[]): string {
  return [
    "<goal-checks-failed>",
    "You ended your turn, but the goal's checks do not pass yet, so the task is not complete. Make the work satisfy them; do not change the checks or what they inspect to make them pass. End your turn when every check passes.",
    resultsText(results),
    "</goal-checks-failed>",
  ].join("\n");
}

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

function checkedTasks(
  runtime: runtimeTypes.Runtime,
  threadId: string,
): orchestratorTypesTypes.Task[] {
  return store
    .assignmentsOfThread(runtime.database, threadId)
    .filter((assignment) => assignment.role === "worker")
    .flatMap((assignment) => store.getTask(runtime.database, assignment.taskId) ?? [])
    .filter((task) => task.checks.length > 0);
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

function decide(
  thread: threadRunTypes.ThreadRun,
  results: readonly CheckResult[] | undefined,
  readBefore: ReadonlySet<string>,
): void {
  const { runtime, threadId, run, worker } = thread;
  if (results === undefined || !threadRuns.current(thread)) return;
  if (runtime.wrapUps.has(threadId)) {
    runtime.afterTurn(threadId, run, worker);
    return;
  }
  if (results.every((result) => result.passed)) {
    rejections.delete(worker);
    if (!threadRuns.continueWithNotes(thread, readBefore)) threadRuns.settle(thread, undefined);
    return;
  }
  const count = (rejections.get(worker) ?? 0) + 1;
  rejections.set(worker, count);
  if (count > MAX_REJECTIONS) {
    threadRuns.settle(
      thread,
      new Error(
        `The goal's checks still fail after ${MAX_REJECTIONS} rounds of fixes.\n${resultsText(results)}`,
      ),
    );
    return;
  }
  threadRuns.continueWith(thread, rejectionPrompt(results));
}

function verify(
  runtime: runtimeTypes.Runtime,
  threadId: string,
  run: number,
  worker: runtimeTypes.WorkerSession,
): void {
  const thread = { run, runtime, threadId, worker };
  const tasks = checkedTasks(runtime, threadId);
  if (tasks.length === 0 || outcomes.outcomeOf(worker, undefined).status !== "completed") {
    threadRuns.settle(thread, undefined);
    return;
  }
  const readBefore = threadRuns.readIds(thread);
  void Effect.runPromise(threadRuns.whileCurrent(thread, runAll(runtime, threadId, tasks))).then(
    (results) => decide(thread, results, readBefore),
    (error: unknown) => threadRuns.settle(thread, error),
  );
}

const goalChecks = { verify };

const goalChecksModule = {
  goalChecks,
};

export default goalChecksModule;
