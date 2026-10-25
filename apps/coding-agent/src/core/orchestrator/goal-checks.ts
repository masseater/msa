import { Effect } from "effect";

import goalCheckRun from "./goal-check-run.ts";
import goalCheckText from "./goal-check-text.ts";
import outcomeModule from "./outcome.ts";
import runtimeModule from "./runtime.ts";
import type runtimeTypes from "./runtime.types.ts";
import TaskStopped from "./task-stopped.ts";
import threadRun from "./thread-run.ts";
import type threadRunTypes from "./thread-run.types.ts";
import workProgress from "./work-progress.ts";

const { outcomes } = outcomeModule;
const { ciStalledText, failureText, passed, rejectionPrompt, stopText, stuckText, waitingForCi } =
  goalCheckText;
const { threadRuns } = threadRun;
const { ciTiming, verifyAll, workerTasks } = goalCheckRun;
const { nowMillis } = runtimeModule;

type Verification = Parameters<typeof passed>[0];

interface Round {
  thread: threadRunTypes.ThreadRun;
  tasks: ReturnType<typeof workerTasks>;
  readBefore: ReadonlySet<string>;
}

interface Checked {
  at: number;
  results: Verification;
  contents: Effect.Success<ReturnType<typeof workProgress.contentsOf>>;
}

function failedOutright(results: Verification): boolean {
  return !passed(results) && stopText(results) === undefined && !waitingForCi(results);
}

function check(round: Round, waitingSince: number | undefined): void {
  const { thread, tasks } = round;
  const { runtime, threadId } = thread;
  const { pollMs } = ciTiming(runtime);
  const checked = Effect.gen(function* () {
    if (waitingSince !== undefined) yield* Effect.sleep(pollMs);
    const results = yield* verifyAll(runtime, threadId, tasks, () => threadRuns.current(thread));
    const contents = failedOutright(results)
      ? yield* workProgress.contentsOf(runtime, threadId)
      : undefined;
    return { at: yield* nowMillis, contents, results } satisfies Checked;
  });
  void Effect.runPromise(threadRuns.whileCurrent(thread, checked)).then(
    (done) => (done === undefined ? undefined : decide(round, done, waitingSince)),
    (error: unknown) => threadRuns.settle(thread, error),
  );
}

function waitOrAsk(round: Round, results: Verification, since: number, now: number): void {
  const limit = ciTiming(round.thread.runtime).waitMs;
  if (now - since < limit) {
    check(round, since);
    return;
  }
  const text = ciStalledText(results, Math.round(limit / 60_000));
  threadRuns.askForDecision(round.thread, { key: text, text, triage: false });
}

function decide(round: Round, checked: Checked, waitingSince: number | undefined): void {
  const { at: now, contents, results } = checked;
  const { thread, readBefore } = round;
  const { runtime, threadId, run, worker } = thread;
  if (!threadRuns.current(thread)) return;
  if (runtime.wrapUps.has(threadId)) {
    runtime.afterTurn(threadId, run, worker);
    return;
  }
  if (passed(results)) {
    workProgress.forget(worker);
    if (!threadRuns.continueWithNotes(thread, readBefore)) threadRuns.settle(thread, undefined);
    return;
  }
  const stop = stopText(results);
  if (stop !== undefined) {
    threadRuns.settle(thread, new TaskStopped({ message: stop }));
    return;
  }
  if (waitingForCi(results)) {
    if (threadRuns.continueWithNotes(thread, readBefore)) return;
    waitOrAsk(round, results, waitingSince ?? now, now);
    return;
  }
  const output = failureText(results);
  if (workProgress.failedWithoutMoving(worker, output, contents)) {
    threadRuns.askForDecision(thread, { key: output, text: stuckText(results), triage: true });
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
