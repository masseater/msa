import { Effect } from "effect";

import goalCheckRun from "./goal-check-run.ts";
import goalCheckText from "./goal-check-text.ts";
import type goalCheckTextTypes from "./goal-check-text.types.ts";
import outcomeModule from "./outcome.ts";
import type runtimeTypes from "./runtime.types.ts";
import threadRun from "./thread-run.ts";
import type threadRunTypes from "./thread-run.types.ts";

const { outcomes } = outcomeModule;
const { failureText, passed, rejectionPrompt } = goalCheckText;
const { threadRuns } = threadRun;
const { MAX_REJECTIONS } = threadRuns;
const { verifyAll, workerTasks } = goalCheckRun;

type Verification = goalCheckTextTypes.Verification;

const rejections = new WeakMap<runtimeTypes.WorkerSession, number>();

function decide(
  thread: threadRunTypes.ThreadRun,
  results: Verification | undefined,
  readBefore: ReadonlySet<string>,
): void {
  const { runtime, threadId, run, worker } = thread;
  if (results === undefined || !threadRuns.current(thread)) return;
  if (runtime.wrapUps.has(threadId)) {
    runtime.afterTurn(threadId, run, worker);
    return;
  }
  if (passed(results)) {
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
        `The goal's checks still fail after ${MAX_REJECTIONS} rounds of fixes.\n${failureText(results)}`,
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
  const tasks = workerTasks(runtime, threadId);
  if (tasks.length === 0 || outcomes.outcomeOf(worker, undefined).status !== "completed") {
    threadRuns.settle(thread, undefined);
    return;
  }
  const readBefore = threadRuns.readIds(thread);
  void Effect.runPromise(threadRuns.whileCurrent(thread, verifyAll(runtime, threadId, tasks))).then(
    (results) => decide(thread, results, readBefore),
    (error: unknown) => threadRuns.settle(thread, error),
  );
}

const goalChecks = { verify };

const goalChecksModule = {
  goalChecks,
};

export default goalChecksModule;
