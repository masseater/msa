import { Effect } from "effect";

import goalCheckRun from "./goal-check-run.ts";
import goalCheckText from "./goal-check-text.ts";
import type goalCheckTextTypes from "./goal-check-text.types.ts";
import outcomeModule from "./outcome.ts";
import runtimeModule from "./runtime.ts";
import type runtimeTypes from "./runtime.types.ts";
import TaskStopped from "./task-stopped.ts";
import threadRun from "./thread-run.ts";
import type threadRunTypes from "./thread-run.types.ts";

const { outcomes } = outcomeModule;
const { failureText, passed, rejectionPrompt, unavailableText, waitingForCi } = goalCheckText;
const { threadRuns } = threadRun;
const { MAX_REJECTIONS } = threadRuns;
const { verifyAll, workerTasks } = goalCheckRun;
const { nowMillis } = runtimeModule;

const CI_POLL_MS = 30_000;
const CI_WAIT_MS = 3 * 60 * 60_000;

type Verification = goalCheckTextTypes.Verification;

interface Round {
  thread: threadRunTypes.ThreadRun;
  tasks: ReturnType<typeof workerTasks>;
  readBefore: ReadonlySet<string>;
}

const rejections = new WeakMap<runtimeTypes.WorkerSession, number>();

function check(round: Round, waitingSince: number | undefined): void {
  const { thread, tasks } = round;
  const { runtime, threadId } = thread;
  const pollMs = runtime.options.ciPollMs ?? CI_POLL_MS;
  const checked = Effect.gen(function* () {
    if (waitingSince !== undefined) yield* Effect.sleep(pollMs);
    const results = yield* verifyAll(runtime, threadId, tasks, () => threadRuns.current(thread));
    return { at: yield* nowMillis, results };
  });
  void Effect.runPromise(threadRuns.whileCurrent(thread, checked)).then(
    (done) => (done === undefined ? undefined : decide(round, done.results, waitingSince, done.at)),
    (error: unknown) => threadRuns.settle(thread, error),
  );
}

function waitOrStop(round: Round, results: Verification, since: number, now: number): void {
  const limit = round.thread.runtime.options.ciWaitMs ?? CI_WAIT_MS;
  if (now - since < limit) {
    check(round, since);
    return;
  }
  threadRuns.settle(
    round.thread,
    new TaskStopped({
      message: `CI did not finish within ${Math.round(limit / 60_000)} minutes, so the task is stopped, not completed. Check whether CI is stuck, then rerun the task.\n${failureText(results)}`,
    }),
  );
}

function decide(
  round: Round,
  results: Verification,
  waitingSince: number | undefined,
  now: number,
): void {
  const { thread, readBefore } = round;
  const { runtime, threadId, run, worker } = thread;
  if (!threadRuns.current(thread)) return;
  if (runtime.wrapUps.has(threadId)) {
    runtime.afterTurn(threadId, run, worker);
    return;
  }
  if (passed(results)) {
    rejections.delete(worker);
    if (!threadRuns.continueWithNotes(thread, readBefore)) threadRuns.settle(thread, undefined);
    return;
  }
  const unavailable = unavailableText(results);
  if (unavailable !== undefined) {
    threadRuns.settle(thread, new TaskStopped({ message: unavailable }));
    return;
  }
  if (waitingForCi(results)) {
    if (threadRuns.continueWithNotes(thread, readBefore)) return;
    waitOrStop(round, results, waitingSince ?? now, now);
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
  check({ readBefore: threadRuns.readIds(thread), tasks, thread }, undefined);
}

const goalChecks = { verify };

const goalChecksModule = {
  goalChecks,
};

export default goalChecksModule;
