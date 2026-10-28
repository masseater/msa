import { Effect } from "effect";
import { expect, it } from "vite-plus/test";

import type FakeWorker from "./fake-worker.ts";
import orchestratorHarness from "./orchestrator-harness.ts";
import type orchestratorHarnessTypes from "./orchestrator-harness.types.ts";
import orchestratorSupport from "./orchestrator-support.ts";
import reviewVerdictSupport from "./review-verdict-support.ts";
import triageSupport from "./triage-support.ts";

const { isTriage, runningTriage } = triageSupport;
const { create } = orchestratorSupport;
const { harness } = orchestratorHarness;
const { setup, taskStatus, waitFor } = harness;
const { classifierDecide } = reviewVerdictSupport;

type Decide = NonNullable<orchestratorHarnessTypes.HarnessOptions["decide"]>;

const GOAL = [
  "- repeated reads hit the cache",
  "- a test covers the second read",
  "- the README documents the cache",
].join("\n");

const FINDING = "The second read's test only checks the first read.";

const met = (item: number, evidence = "checked in the diff") => ({
  evidence,
  item,
  status: "met" as const,
});

const ALL_MET = [met(1), met(2), met(3)];

const UNDECIDED: ReadonlyArray<readonly [string, Decide, string]> = [
  [
    "the decision model is unavailable",
    classifierDecide({ unavailable: "the classifier backend cannot load" }),
    "the classifier backend cannot load",
  ],
  [
    "no answer reaches the threshold",
    classifierDecide(() => ({ fail: 0.49, pass: 0.51 })),
    "no answer reached the threshold",
  ],
  [
    "the decision times out",
    () => Promise.reject(new Error("the decision timed out after 15000ms")),
    "the decision timed out after 15000ms",
  ],
];

const reviewing = (decide: Decide) =>
  Effect.gen(function* () {
    const setUp = setup({ decide });
    const task = yield* create(setUp.orchestrator, {
      currentState: "repeated reads go to the network",
      goalState: GOAL,
      title: "cache reads",
    });
    setUp.workers[0]!.complete("added the cache, its test, and the README section");
    yield* waitFor(() => setUp.workers.length === 2);
    return { ...setUp, reviewer: setUp.workers[1]!, task };
  });

const review = (
  reviewer: FakeWorker,
  items: Parameters<FakeWorker["recordGoalItems"]>[0],
  findings: readonly string[],
  report: string,
) =>
  Effect.gen(function* () {
    yield* Effect.promise(() => reviewer.recordGoalItems(items, findings));
    reviewer.completeUnrecorded(report);
  });

const triages = (workers: readonly FakeWorker[]) => workers.filter(isTriage).length;

const passesOnTheRecord = (decide: Decide, reason: string) => () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator, reports, reviewer, task, workers } = yield* reviewing(decide);
      yield* review(reviewer, ALL_MET, [], "Acceptable. All three items are met.");
      yield* waitFor(() => taskStatus(orchestrator, task.id) === "completed");
      expect(triages(workers)).toBe(0);
      expect(reports.map((report) => report.details.status)).not.toContain("needs-decision");
      const text = reports.at(-1)?.text ?? "";
      expect(text).toContain("Review verdict: pass (");
      expect(text).toContain(reason);
      expect(text).toContain("Goal items: all 3 met.");
    }),
  );

it.each(UNDECIDED)(
  "passes a review whose reviewer records every goal item met with evidence and no finding when %s, without a triage",
  (_case, decide, reason) => passesOnTheRecord(decide, reason)(),
);

const triagedUndecided = (
  items: Parameters<FakeWorker["recordGoalItems"]>[0],
  findings: readonly string[],
) =>
  Effect.gen(function* () {
    const setUp = yield* reviewing(UNDECIDED[0]![1]);
    yield* review(setUp.reviewer, items, findings, "Acceptable.");
    yield* waitFor(() => runningTriage(setUp.workers) !== undefined);
    expect(taskStatus(setUp.orchestrator, setUp.task.id)).toBe("running");
    expect(setUp.reports.at(-1)?.text).toContain("Review verdict: undecided (");
    return { ...setUp, triage: runningTriage(setUp.workers)! };
  });

it("leaves a review with every item met but a recorded finding undecided, and triages it", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { reports, triage } = yield* triagedUndecided(ALL_MET, [FINDING]);
      expect(triage.prompts[0]).toContain(FINDING);
      expect(reports.at(-1)?.text).toContain(`Findings within the goal:\n- ${FINDING}`);
    }),
  ));

it("leaves a review with an item met without evidence undecided, and triages it", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { triage } = yield* triagedUndecided([met(1), met(2, "  "), met(3)], []);
      expect(triage.prompts[0]).toContain("the classifier backend cannot load");
    }),
  ));

it.each(UNDECIDED)(
  "sends a review with an item recorded unmet back to the worker when %s",
  (_case, decide) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { orchestrator, reports, reviewer, task, workers } = yield* reviewing(decide);
        yield* review(
          reviewer,
          [met(1), met(2), { evidence: "no README section", item: 3, status: "unmet" }],
          [],
          "Acceptable.",
        );
        yield* waitFor(() => workers.length === 3);
        expect(triages(workers)).toBe(0);
        expect(taskStatus(orchestrator, task.id)).toBe("running");
        expect(reports.at(-1)?.details.status).toBe("sent-back");
        expect(reports.at(-1)?.text).toContain("Review verdict: fail (");
      }),
    ),
);

it("sends a review the decision model fails back to the worker even when every item is recorded met", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const failing = classifierDecide(() => ({ fail: 0.9, pass: 0.1 }));
      const { orchestrator, reports, reviewer, task, workers } = yield* reviewing(failing);
      yield* review(reviewer, ALL_MET, [], "Acceptable.");
      yield* waitFor(() => workers.length === 3);
      expect(taskStatus(orchestrator, task.id)).toBe("running");
      expect(reports.at(-1)?.details.status).toBe("sent-back");
    }),
  ));

const JUDGE_AGAIN = {
  conclusion: "decided",
  decision: "Check the second read's test again, record the goal items, and end the turn.",
  goalItems: [
    { how: "The diff holds the cache.", item: 1 },
    { how: "The reviewer checks the test again.", item: 2 },
    { how: "The diff holds the README section.", item: 3 },
  ],
  grounds: "The work is in the diff; only the reviewer's finding is open.",
};

it("passes the reviewer's next review on its record after one triage, instead of triaging the same undecided verdict again", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator, reports, reviewer, task, triage, workers } = yield* triagedUndecided(
        ALL_MET,
        [FINDING],
      );
      yield* Effect.promise(() => triage.concludeTriage(JUDGE_AGAIN));
      yield* waitFor(() => reviewer.prompts.length === 2);
      expect(reviewer.prompts[1]).toContain(JUDGE_AGAIN.decision);
      yield* review(reviewer, ALL_MET, [], "Acceptable. The test checks the second read.");
      yield* waitFor(() => taskStatus(orchestrator, task.id) === "completed");
      expect(triages(workers)).toBe(1);
      expect(reports.map((report) => report.details.status)).not.toContain("needs-decision");
      expect(reports.at(-1)?.text).toContain("Review verdict: pass (");
    }),
  ));
