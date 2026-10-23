import { Effect } from "effect";

import outcomeModule from "./outcome.ts";
import promptsModule from "./prompts.ts";
import runtimeModule from "./runtime.ts";
import type runtimeTypes from "./runtime.types.ts";
import storeModule from "./store.ts";
import text from "./text.ts";
import type orchestratorTypesTypes from "./types.types.ts";
import type workerTypes from "./worker.ts";

const { store } = storeModule;
const { outcomes } = outcomeModule;
const { prompts } = promptsModule;
const { nowMillis } = runtimeModule;
const { outputPattern } = text;

const CHECK_TIMEOUT_MS = 10 * 60_000;
const RUN_POLL_MS = 100;
const MAX_REJECTIONS = 3;
const OUTPUT_LIMIT = 3000;

interface CheckResult {
  check: orchestratorTypesTypes.TaskCheck;
  exitCode: number | null;
  output: string;
  passed: boolean;
}

interface ThreadRun {
  runtime: runtimeTypes.Runtime;
  threadId: string;
  run: number;
  worker: workerTypes.WorkerSession;
}

const rejections = new WeakMap<workerTypes.WorkerSession, number>();

function clip(output: string): string {
  return output.length <= OUTPUT_LIMIT ? output : `[…]\n${output.slice(-OUTPUT_LIMIT)}`;
}

function resultsText(results: readonly CheckResult[]): string {
  return results
    .map((result) => {
      const got = result.exitCode === null ? "no exit code" : `exit ${result.exitCode}`;
      return [
        `<check command="${result.check.command}" expected="${prompts.checkExpectation(result.check)}" got="${got}" passed="${result.passed}">`,
        clip(result.output.trim()),
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

function markActive(thread: ThreadRun): Effect.Effect<void> {
  return Effect.map(nowMillis, (at) => {
    thread.runtime.activity.set(thread.threadId, { at, messages: thread.worker.messages.length });
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

function current(thread: ThreadRun): boolean {
  return thread.runtime.runs.get(thread.threadId) === thread.run;
}

function whileCurrent<A>(
  thread: ThreadRun,
  effect: Effect.Effect<A>,
): Effect.Effect<A | undefined> {
  const ended = Effect.gen(function* () {
    while (current(thread)) {
      yield* markActive(thread);
      yield* Effect.sleep(RUN_POLL_MS);
    }
    return undefined;
  });
  return Effect.race(effect, ended);
}

function readIds(thread: ThreadRun): Set<string> {
  return new Set(
    store.notesReadBy(thread.runtime.database, thread.threadId).map((note) => note.id),
  );
}

function settle(thread: ThreadRun, error: unknown): void {
  void thread.runtime.settle(thread.threadId, thread.run, thread.worker, error);
}

function continueWith(thread: ThreadRun, prompt: string): void {
  const { runtime, threadId, run, worker } = thread;
  void worker.run.prompting.prompt(prompt).then(
    () => runtime.afterTurn(threadId, run, worker),
    (error: unknown) => settle(thread, error),
  );
}

function decide(
  thread: ThreadRun,
  results: readonly CheckResult[] | undefined,
  readBefore: ReadonlySet<string>,
): void {
  const { runtime, threadId, run, worker } = thread;
  if (results === undefined || !current(thread)) return;
  if (runtime.wrapUps.has(threadId)) {
    runtime.afterTurn(threadId, run, worker);
    return;
  }
  if (results.every((result) => result.passed)) {
    const arrived = store
      .notesReadBy(runtime.database, threadId)
      .filter((note) => !readBefore.has(note.id));
    if (arrived.length === 0) settle(thread, undefined);
    else continueWith(thread, prompts.notesBlock(arrived));
    return;
  }
  const count = (rejections.get(worker) ?? 0) + 1;
  rejections.set(worker, count);
  if (count > MAX_REJECTIONS) {
    settle(
      thread,
      new Error(
        `The goal's checks still fail after ${MAX_REJECTIONS} rounds of fixes.\n${resultsText(results)}`,
      ),
    );
    return;
  }
  continueWith(thread, rejectionPrompt(results));
}

function verify(
  runtime: runtimeTypes.Runtime,
  threadId: string,
  run: number,
  worker: workerTypes.WorkerSession,
): void {
  const thread = { run, runtime, threadId, worker };
  const tasks = checkedTasks(runtime, threadId);
  if (tasks.length === 0 || outcomes.outcomeOf(worker, undefined).status !== "completed") {
    settle(thread, undefined);
    return;
  }
  const readBefore = readIds(thread);
  void Effect.runPromise(whileCurrent(thread, runAll(runtime, threadId, tasks))).then(
    (results) => decide(thread, results, readBefore),
    (error: unknown) => settle(thread, error),
  );
}

const goalChecks = { verify };

const goalChecksModule = {
  goalChecks,
};

export default goalChecksModule;
