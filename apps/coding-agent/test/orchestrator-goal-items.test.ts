import testing from "@msa/testing";
import { Effect } from "effect";
import { expect, it } from "vite-plus/test";

import orchestratorHarness from "./orchestrator-harness.ts";
import orchestratorSupport from "./orchestrator-support.ts";
import reviewVerdictSupport from "./review-verdict-support.ts";
import triageSupport from "./triage-support.ts";

const { makeTempDir, removePath } = testing;
const { escalateTriage } = triageSupport;
const { create } = orchestratorSupport;
const { harness } = orchestratorHarness;
const { setup, taskStatus, waitFor } = harness;
const { passingDecide } = reviewVerdictSupport;

const GOAL = [
  "- repeated reads hit the cache",
  "- a test covers the second read",
  "- the README documents the cache",
].join("\n");

const PARAPHRASES = [
  "Known limitation: the README section is left out.",
  "Out of scope for this change: the README.",
  "The README goes to a separate issue.",
  "Follow-up: document the cache in the README.",
  "既知の限界: README には書いていない。",
  "README は範囲外とした。",
  "README は別 issue で対応する。",
];

const met = (item: number) => ({ evidence: "checked", item, status: "met" as const });

const reviewing = (where: { databasePath?: string } = {}) =>
  Effect.gen(function* () {
    const setUp = setup({ ...where, decide: passingDecide });
    const task = yield* create(setUp.orchestrator, {
      currentState: "repeated reads go to the network",
      goalState: GOAL,
      title: "cache reads",
    });
    setUp.workers[0]!.complete("added the cache and its test");
    yield* waitFor(() => setUp.workers.length === 2);
    return { ...setUp, reviewer: setUp.workers[1]!, task };
  });

const doesNotPassAnUnmetItem = (paraphrase: string) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator, reports, reviewer, task, workers } = yield* reviewing();
      expect(reviewer.goalItemCount()).toBe(3);
      yield* Effect.promise(() =>
        reviewer.recordGoalItems([
          met(1),
          met(2),
          { evidence: paraphrase, item: 3, status: "unmet" },
        ]),
      );
      reviewer.completeUnrecorded(`Acceptable. ${paraphrase}`);
      yield* waitFor(() => workers.length === 3);
      expect(taskStatus(orchestrator, task.id)).toBe("running");
      expect(reports.at(-1)?.details.status).toBe("sent-back");
      expect(reports.at(-1)?.text).toContain("Review verdict: fail");
      expect(reports.at(-1)?.text).toContain("Goal items: 1 of 3 unmet.");
      expect(workers[2]!.prompts[0]).toContain(`3. [unmet] the README documents the cache`);
      expect(workers[2]!.prompts[0]).toContain(paraphrase);
    }),
  );

it.each(PARAPHRASES)(
  "sends the work back when the reviewer records a goal item unmet, however the report words it and even when the decision model passes it: %s",
  doesNotPassAnUnmetItem,
);

const doesNotPassWithoutARecord = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator, reports, reviewer, task } = yield* reviewing();
      reviewer.completeUnrecorded("Acceptable. Every item is met.");
      yield* waitFor(() => reviewer.prompts.length === 2);
      expect(reviewer.prompts[1]).toContain("goal-items-not-recorded");
      expect(reviewer.prompts[1]).toContain("3. the README documents the cache");
      expect(taskStatus(orchestrator, task.id)).toBe("running");

      yield* Effect.promise(() =>
        expect(reviewer.recordGoalItems([met(1), met(2)])).rejects.toThrow(
          "The goal has 3 items; the record has 2 entries and none for item 3.",
        ),
      );
      yield* Effect.promise(() =>
        expect(reviewer.recordGoalItems([met(1), met(2), met(2)])).rejects.toThrow(
          "none for item 3",
        ),
      );
      reviewer.completeUnrecorded("Acceptable, I said so already.");
      yield* waitFor(() => taskStatus(orchestrator, task.id) === "needs-decision");
      expect(reports.at(-1)?.text).toContain("Review verdict: undecided");
      expect(reports.at(-1)?.text).toContain("did not record whether each goal item is met");
    }),
  );

it(
  "asks a reviewer that records no goal items, or the wrong number of them, to record them, and waits for a decision instead of passing when it still does not",
  doesNotPassWithoutARecord,
);

const passesOnlyWhenEveryItemIsMet = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator, reviewer, task } = yield* reviewing();
      reviewer.completeUnrecorded("Acceptable.");
      yield* waitFor(() => reviewer.prompts.length === 2);
      yield* Effect.promise(() => reviewer.recordGoalItems([met(3), met(1), met(2)]));
      reviewer.completeUnrecorded("Acceptable. All three items are met.");
      yield* waitFor(() => taskStatus(orchestrator, task.id) === "completed");
      const view = yield* Effect.promise(() => orchestrator.read(task.id));
      expect(view.reports.at(-1)?.content).toContain("Goal items: all 3 met.");
    }),
  );

it("passes a review once the reviewer records every goal item met", passesOnlyWhenEveryItemIsMet);

const keepsTheGateAfterAReopen = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* makeTempDir("msa-goal-items-");
      const databasePath = `${directory}/orchestrator.db`;
      const first = yield* reviewing({ databasePath });
      yield* Effect.promise(() =>
        first.reviewer.requestDecision({
          options: [{ choice: "Judge without the README", tradeoffs: "One item unchecked" }],
          unmet: "The README item cannot be checked yet.",
        }),
      );
      yield* escalateTriage(first.workers);
      yield* waitFor(() => taskStatus(first.orchestrator, first.task.id) === "needs-decision");
      yield* Effect.promise(() => first.orchestrator.dispose());

      const { orchestrator, reports, workers } = setup({ databasePath, decide: passingDecide });
      yield* Effect.promise(() =>
        orchestrator.sendMessage(first.task.id, "Judge every item, the README included."),
      );
      yield* waitFor(() => workers.length === 1);
      const reopened = workers[0]!;
      expect(reopened.prompts[0]).toContain("Judge every item, the README included.");
      expect(reopened.goalItemCount()).toBe(3);
      yield* Effect.promise(() =>
        reopened.recordGoalItems([
          met(1),
          met(2),
          { evidence: "Known limitation: no README.", item: 3, status: "unmet" },
        ]),
      );
      reopened.completeUnrecorded("Acceptable. Known limitation: no README.");
      yield* waitFor(() => workers.length === 2);
      expect(taskStatus(orchestrator, first.task.id)).toBe("running");
      expect(reports.at(-1)?.details.status).toBe("sent-back");
      yield* Effect.promise(() => orchestrator.dispose());
      yield* removePath(directory);
    }),
  );

it(
  "gives a reviewer reopened after a restart the goal-item record and still sends the work back for an unmet item",
  keepsTheGateAfterAReopen,
);
