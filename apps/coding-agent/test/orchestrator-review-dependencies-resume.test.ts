import { Clock, Effect } from "effect";
import { afterEach, expect, it, vi } from "vite-plus/test";

import type orchestratorTypes from "../src/core/orchestrator/orchestrator.types.ts";
import orchestratorHarness from "./orchestrator-harness.ts";
import orchestratorSupport from "./orchestrator-support.ts";
import watchdogSupport from "./orchestrator-watchdog-support.ts";
import providerWaitSupport from "./provider-wait-support.ts";
import triageSupport from "./triage-support.ts";

const { create } = orchestratorSupport;
const { setup, taskStatus, waitFor } = orchestratorHarness.harness;
const { advance, fakeClock, settledUntil } = watchdogSupport;
const { HOUR, MINUTE, sessionLimit } = providerWaitSupport;
const { escalateTriage } = triageSupport;

type Orchestrator = orchestratorTypes.Orchestrator;

afterEach(() => {
  vi.useRealTimers();
});

const work = (title: string, round?: string) => ({
  currentState: `${title} is not written`,
  goalState: `${title} works`,
  title,
  ...(round === undefined ? {} : { round }),
});

const REQUEST = {
  options: [{ choice: "Judge it as it stands", tradeoffs: "Misses the later change" }],
  recommendation: "Judge it as it stands",
  unmet: "The goal and the code disagree on the API name.",
};

function runningReviewers(orchestrator: Orchestrator, taskId: string): string[] {
  const running = new Set(
    orchestrator.snapshot.threads
      .filter((thread) => thread.status === "running")
      .map((thread) => thread.id),
  );
  return (orchestrator.snapshot.tasks.find((task) => task.id === taskId)?.assignments ?? [])
    .filter((assignment) => assignment.role === "reviewer" && running.has(assignment.threadId))
    .map((assignment) => assignment.threadId);
}

function viewOf(orchestrator: Orchestrator, taskId: string) {
  return orchestrator.snapshot.tasks.find((task) => task.id === taskId);
}

it("keeps a task review that hit a provider limit from resuming while a dependency added during the wait is unfinished", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      yield* fakeClock();
      const { orchestrator, workers } = setup({ maxConcurrent: 2, pollIntervalMs: 5000 });
      const a = yield* create(orchestrator, work("a"));
      workers[0]!.complete("a done");
      yield* settledUntil(() => workers.length === 2);
      const reviewer = workers[1]!;
      reviewer.endTurnWithError(sessionLimit((yield* Clock.currentTimeMillis) + HOUR));
      yield* advance(0);
      expect(taskStatus(orchestrator, a.id)).toBe("waiting");

      const b = yield* create(orchestrator, work("b", "later"));
      yield* settledUntil(() => taskStatus(orchestrator, b.id) === "running");
      yield* Effect.promise(() => orchestrator.stop(b.id));
      yield* Effect.promise(() => orchestrator.setDepends({ add: [b.id], taskIds: [a.id] }));
      const before = workers.length;

      yield* advance(HOUR + MINUTE + 30_000);
      expect(workers.slice(before).some((worker) => worker.openedSessionFile !== undefined)).toBe(
        false,
      );
      expect(taskStatus(orchestrator, a.id)).toBe("waiting");
      expect(runningReviewers(orchestrator, a.id)).toEqual([]);
      expect(viewOf(orchestrator, a.id)?.waitingReason?.kind).toBe("dependencies");

      yield* Effect.promise(() => orchestrator.sendMessage(b.id, "Carry on."));
      yield* settledUntil(() => workers.length > before);
      workers.at(-1)!.complete("b done");
      yield* settledUntil(() => workers.length > before + 1);
      workers.at(-1)!.complete("b reviewed");
      yield* settledUntil(() => taskStatus(orchestrator, b.id) === "completed");
      yield* settledUntil(() => taskStatus(orchestrator, a.id) === "running");
      yield* Effect.promise(() => orchestrator.dispose());
    }),
  ));

it("keeps a reviewer answered by send_message from resuming while a dependency added during the decision is unfinished", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator, workers } = setup({ maxConcurrent: 2 });
      const a = yield* create(orchestrator, work("a"));
      workers[0]!.complete("a done");
      yield* waitFor(() => workers.length === 2);
      const reviewer = workers[1]!;
      yield* Effect.promise(() => reviewer.requestDecision(REQUEST));
      yield* escalateTriage(workers);
      yield* waitFor(() => taskStatus(orchestrator, a.id) === "needs-decision");

      const b = yield* create(orchestrator, work("b", "later"));
      yield* waitFor(() => taskStatus(orchestrator, b.id) === "running");
      const bWorker = workers.at(-1)!;
      yield* Effect.promise(() => orchestrator.setDepends({ add: [b.id], taskIds: [a.id] }));

      yield* Effect.promise(() =>
        orchestrator.sendMessage(a.id, "Judge it with the API name in the goal."),
      );
      expect(reviewer.prompts).toHaveLength(1);
      expect(taskStatus(orchestrator, a.id)).toBe("waiting");
      expect(runningReviewers(orchestrator, a.id)).toEqual([]);
      expect(viewOf(orchestrator, a.id)?.waitingReason?.kind).toBe("dependencies");

      const before = workers.length;
      bWorker.complete("b done");
      yield* waitFor(() => workers.length > before);
      workers.at(-1)!.complete("b reviewed");
      yield* waitFor(() => taskStatus(orchestrator, a.id) === "running");
      const resumed = workers
        .slice(before)
        .find((worker) => worker.prompts[0]?.includes("a is not written"));
      expect(resumed?.prompts[0]).toContain("Judge it with the API name in the goal.");
    }),
  ));

it("resumes a worker that hit a provider limit in its own session only once a dependency added during the wait completes", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      yield* fakeClock();
      const { orchestrator, workers } = setup({ maxConcurrent: 2, pollIntervalMs: 5000 });
      const a = yield* create(orchestrator, work("a"));
      const first = workers[0]!;
      first.endTurnWithError(sessionLimit((yield* Clock.currentTimeMillis) + HOUR));
      yield* advance(0);
      expect(taskStatus(orchestrator, a.id)).toBe("waiting");

      const b = yield* create(orchestrator, work("b", "later"));
      yield* settledUntil(() => taskStatus(orchestrator, b.id) === "running");
      yield* Effect.promise(() => orchestrator.stop(b.id));
      yield* Effect.promise(() => orchestrator.setDepends({ add: [b.id], taskIds: [a.id] }));
      const before = workers.length;

      yield* advance(HOUR + MINUTE + 30_000);
      expect(workers).toHaveLength(before);
      expect(taskStatus(orchestrator, a.id)).toBe("waiting");
      expect(viewOf(orchestrator, a.id)?.waitingReason?.kind).toBe("dependencies");

      yield* Effect.promise(() => orchestrator.sendMessage(b.id, "Carry on."));
      yield* settledUntil(() => workers.length > before);
      workers.at(-1)!.complete("b done");
      yield* settledUntil(() => workers.length > before + 1);
      workers.at(-1)!.complete("b reviewed");
      yield* settledUntil(() => taskStatus(orchestrator, a.id) === "running");
      expect(workers.some((worker) => worker.openedSessionFile === first.sessionFile)).toBe(true);
      yield* Effect.promise(() => orchestrator.dispose());
    }),
  ));
