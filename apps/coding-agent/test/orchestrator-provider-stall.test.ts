import { Effect } from "effect";
import { afterEach, expect, it, vi } from "vite-plus/test";

import orchestratorHarness from "./orchestrator-harness.ts";
import watchdogSupport from "./orchestrator-watchdog-support.ts";
import providerWaitSupport from "./provider-wait-support.ts";
import triageSupport from "./triage-support.ts";

const { taskStatus } = orchestratorHarness.harness;
const { advance } = watchdogSupport;
const { HOUR, SESSION_LIMIT, limitAgain, resumeAll, settledUntil, snapshotOf, startedTask } =
  providerWaitSupport;
const DECIDED = {
  conclusion: "decided",
  decision: "The limit resets tonight; continue the cache work in this session once it does.",
  goalItems: [{ how: "The cache work goes on in the same session.", item: 1 }],
  grounds: "The error is a usage limit with a reset time, so waiting for it clears it.",
};
const { isTriage } = triageSupport;

afterEach(() => {
  vi.useRealTimers();
});

const NOT_MOVING = "The work is not moving: the provider limit";

const stalledTask = Effect.gen(function* () {
  const started = yield* startedTask();
  yield* limitAgain(started, 0, false);
  yield* resumeAll(started, 2);
  yield* limitAgain(started, 1, false);
  yield* settledUntil(() => started.workers.length === 3);
  const triage = started.workers[2];
  if (triage === undefined || !isTriage(triage)) throw new Error("no triage started");
  return { ...started, triage };
});

const triagesAStallAndWaitsForTheDecision = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const started = yield* stalledTask;
      const { orchestrator, reports, task, triage, workers } = started;

      expect(triage.prompts[0]).toContain(NOT_MOVING);
      expect(triage.prompts[0]).toContain(SESSION_LIMIT);
      expect(snapshotOf(started)?.waitingReason).toBeNull();
      expect(reports.at(-1)?.details.status).toBe("waiting");
      expect(reports.at(-1)?.text).toContain(NOT_MOVING);
      expect(reports.at(-1)?.text).toContain("A triage thread checks first");

      yield* Effect.promise(() => triage.escalate());
      yield* settledUntil(() => taskStatus(orchestrator, task.id) === "needs-decision");
      expect(taskStatus(orchestrator, task.id)).toBe("needs-decision");
      expect(reports.at(-1)?.details).toMatchObject({ role: "triage", status: "needs-decision" });
      expect(reports.at(-1)?.text).toContain(NOT_MOVING);

      yield* advance(3 * HOUR);
      expect(workers).toHaveLength(3);
      expect(taskStatus(orchestrator, task.id)).toBe("needs-decision");

      yield* Effect.promise(() => orchestrator.sendMessage(task.id, "The limit is lifted; go on."));
      yield* settledUntil(() => workers[1]?.prompts.length === 2);
      expect(workers).toHaveLength(3);
      expect(workers[1]?.prompts[1]).toContain("The limit is lifted; go on.");
      expect(workers[1]?.prompts[1]).toContain(NOT_MOVING);
      expect(taskStatus(orchestrator, task.id)).toBe("running");
      yield* Effect.promise(() => orchestrator.dispose());
    }),
  );

it(
  "sends a resumed thread that stops on the same provider error without progress to a triage, then to needs-decision, and answering resumes the same session",
  triagesAStallAndWaitsForTheDecision,
);

const continuesTheSameSessionWithTheTriageDecision = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator, reports, task, triage, workers } = yield* stalledTask;

      yield* Effect.promise(() => triage.concludeTriage(DECIDED));
      yield* settledUntil(() => workers[1]?.prompts.length === 2);
      expect(workers).toHaveLength(3);
      expect(workers[1]?.prompts[1]).toContain(DECIDED.decision);
      expect(taskStatus(orchestrator, task.id)).toBe("running");
      expect(reports.map((report) => report.details.status)).not.toContain("needs-decision");
      yield* Effect.promise(() => orchestrator.dispose());
    }),
  );

it(
  "continues the stalled thread's own session with the decision when the triage decides",
  continuesTheSameSessionWithTheTriageDecision,
);
