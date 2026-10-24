import { Effect } from "effect";

import outcomeModule from "./outcome.ts";
import runtimeModule from "./runtime.ts";
import type runtimeTypes from "./runtime.types.ts";
import schedule from "./schedule.ts";
import start from "./start.ts";
import storeModule from "./store.ts";
import wrapUp from "./wrap-up.ts";

const { nowMillis, releaseThread } = runtimeModule;
const { store } = storeModule;
const { outcomes } = outcomeModule;
const { wrapping } = wrapUp;
const { starting } = start;
const { scheduling } = schedule;

function startFollowUps(
  runtime: runtimeTypes.Runtime,
  applied: ReturnType<typeof outcomes.applyOutcome>,
  report: string,
): Effect.Effect<string[], runtimeTypes.OrchestratorError> {
  return Effect.gen(function* () {
    for (const task of applied.review) {
      yield* starting.startTasks(runtime, task, "reviewer", report);
    }
    for (const item of applied.sendBack) {
      yield* starting.startTasks(runtime, item.task, "worker", "", item.prompt);
    }
    const scheduled = yield* scheduling.scheduleEffect(runtime);
    return [...applied.sendBack.map((item) => item.task.id), ...scheduled];
  });
}

function settleEffect(
  runtime: runtimeTypes.Runtime,
  threadId: string,
  run: number,
  worker: runtimeTypes.WorkerSession,
  error: unknown,
  verdict?: runtimeTypes.ReviewVerdict,
): Effect.Effect<void, runtimeTypes.OrchestratorError> {
  return Effect.gen(function* () {
    if (runtime.runs.get(threadId) !== run) return;
    const now = yield* nowMillis;
    const thread = store.getThread(runtime.database, threadId);
    if (thread === undefined) return;
    const assignments = store.assignmentsOfThread(runtime.database, threadId);
    runtime.runs.delete(threadId);
    runtime.runStartedAt.delete(threadId);
    releaseThread(runtime, threadId);
    const outcome = outcomes.outcomeOf(worker, error);
    if (outcome.status !== "completed") {
      wrapping.fail(runtime, threadId, `wrap-up failed: ${outcome.content}`);
    }
    const applied = yield* Effect.sync(() => {
      store.updateThread(runtime.database, threadId, { status: outcome.status }, now);
      return outcomes.applyOutcome(runtime, assignments, outcome, now, verdict);
    });
    const started = yield* startFollowUps(runtime, applied, outcome.content);
    const judged = { ...outcome, content: [...applied.lines, outcome.content].join("\n\n") };
    yield* Effect.sync(() => {
      runtime.publish();
      const first = assignments[0];
      runtime.options.report(
        outcomes.reportText(runtime, assignments, judged, applied.status, started),
        {
          role: first?.role ?? "worker",
          started,
          status: applied.status,
          taskId: first?.taskId ?? threadId,
        },
      );
    });
  });
}

function settle(
  runtime: runtimeTypes.Runtime,
  threadId: string,
  run: number,
  worker: runtimeTypes.WorkerSession,
  error: unknown,
  verdict?: runtimeTypes.ReviewVerdict,
): Promise<void> {
  return runtime.exclusive(settleEffect(runtime, threadId, run, worker, error, verdict));
}

const settling = { settle };

const settleModule = {
  settling,
};

export default settleModule;
