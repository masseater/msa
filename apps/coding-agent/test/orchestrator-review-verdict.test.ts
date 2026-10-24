import type aiTypes from "@msa/ai/index.types";
import testing from "@msa/testing";
import { Effect } from "effect";
import { expect, it } from "vite-plus/test";

import orchestratorHarness from "./orchestrator-harness.ts";
import orchestratorSupport from "./orchestrator-support.ts";
import reviewVerdictSupport from "./review-verdict-support.ts";

const { makeTempDir, removePath } = testing;
const { create } = orchestratorSupport;
const { harness } = orchestratorHarness;
const { setup, taskStatus, waitFor } = harness;
const { classifierDecide, reportOf } = reviewVerdictSupport;

const FINDING = "Within the goal: the second read is not covered by a test.";

const GOAL = "repeated reads hit the cache and a test covers the second read";

function findingsFail(seen: aiTypes.JsonObject[] = []) {
  return classifierDecide((state) => {
    seen.push(state);
    return reportOf(state).includes(FINDING) ? { fail: 0.9, pass: 0.1 } : { fail: 0.1, pass: 0.9 };
  });
}

const startCacheTask = (decide: ReturnType<typeof classifierDecide>, databasePath?: string) =>
  Effect.gen(function* () {
    const setUp = setup(databasePath === undefined ? { decide } : { databasePath, decide });
    const task = yield* create(setUp.orchestrator, {
      currentState: "repeated reads go to the network",
      goalState: GOAL,
      title: "cache reads",
    });
    setUp.workers[0]?.complete("added the cache");
    yield* waitFor(() => setUp.workers.length === 2);
    return { ...setUp, task };
  });

const roles = (view: { assignments: readonly { role: string }[] }) =>
  view.assignments.map((assignment) => assignment.role);

const sendsAFailedReviewBackToTheWorker = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const seen: aiTypes.JsonObject[] = [];
      const { orchestrator, reports, task, workers } = yield* startCacheTask(findingsFail(seen));

      workers[1]?.complete(`Not acceptable.\n${FINDING}`);
      yield* waitFor(() => workers.length === 3);
      expect(seen.at(-1)).toEqual({ goalState: GOAL, report: `Not acceptable.\n${FINDING}` });
      expect(workers[2]?.prompts[0]).toContain(FINDING);
      expect(taskStatus(orchestrator, task.id)).toBe("running");
      const sentBack = yield* Effect.promise(() => orchestrator.read(task.id));
      expect(roles(sentBack)).toEqual(["worker", "reviewer", "worker"]);
      expect(sentBack.reports.at(-1)?.content).toContain("fail 0.90");
      expect(reports.at(-1)?.details).toMatchObject({ started: [task.id], status: "failed" });

      workers[2]?.complete("covered the second read");
      yield* waitFor(() => workers.length === 4);
      expect(workers[3]?.prompts[0]).toContain("covered the second read");
      workers[3]?.complete("Acceptable. Nothing within the goal remains.");
      yield* waitFor(() => taskStatus(orchestrator, task.id) === "completed");
      const passed = yield* Effect.promise(() => orchestrator.read(task.id));
      expect(passed.reports.at(-1)?.content).toContain("pass 0.90");
      expect(reports.at(-1)?.details.status).toBe("completed");
    }),
  );

it(
  "sends a review that leaves findings within the goal back to the worker and completes the task only after a passing review",
  sendsAFailedReviewBackToTheWorker,
);

const failsAfterThreeRoundsOfFixes = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator, reports, task, workers } = yield* startCacheTask(findingsFail());
      for (let round = 1; round <= 3; round++) {
        workers.at(-1)?.complete(FINDING);
        yield* waitFor(() => workers.length === 2 * round + 1);
        workers.at(-1)?.complete(`fixed, try ${round}`);
        yield* waitFor(() => workers.length === 2 * round + 2);
      }
      workers.at(-1)?.complete(FINDING);
      yield* waitFor(() => taskStatus(orchestrator, task.id) === "failed");
      expect(workers).toHaveLength(8);
      expect(reports.at(-1)?.details).toMatchObject({ started: [], status: "failed" });
    }),
  );

it(
  "fails the task when the review still leaves findings after three rounds of fixes",
  failsAfterThreeRoundsOfFixes,
);

const doesNotCompleteAnUndecidedReview =
  (decide: ReturnType<typeof classifierDecide>, reason: string) => () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { orchestrator, reports, task, workers } = yield* startCacheTask(decide);

        workers[1]?.complete("Acceptable. Nothing within the goal remains.");
        yield* waitFor(() => taskStatus(orchestrator, task.id) === "stopped");
        yield* Effect.sleep(20);
        expect(taskStatus(orchestrator, task.id)).toBe("stopped");
        expect(workers).toHaveLength(2);
        expect(reports.at(-1)?.details).toMatchObject({
          role: "reviewer",
          started: [],
          status: "failed",
        });
        expect(reports.at(-1)?.text).toContain("undecided");
        expect(reports.at(-1)?.text).toContain(reason);
        const view = yield* Effect.promise(() => orchestrator.read(task.id));
        expect(view.reports.at(-1)?.content).toContain("undecided");
      }),
    );

it(
  "stops the task instead of completing it when the decision model is unavailable",
  doesNotCompleteAnUndecidedReview(
    classifierDecide({ unavailable: "the classifier backend cannot load" }),
    "the classifier backend cannot load",
  ),
);

it(
  "stops the task instead of completing it when no verdict reaches the threshold",
  doesNotCompleteAnUndecidedReview(
    classifierDecide(() => ({ fail: 0.4, pass: 0.6 })),
    "no answer reached the threshold",
  ),
);

const keepsTheFindingsAndTheRoundsAcrossARestart = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* makeTempDir("msa-review-verdict-");
      const databasePath = `${directory}/orchestrator.db`;
      const decide = findingsFail();
      const first = yield* startCacheTask(decide, databasePath);
      first.workers[1]?.complete(FINDING);
      yield* waitFor(() => first.workers.length === 3);
      yield* Effect.promise(() => first.orchestrator.dispose());

      const { orchestrator, workers } = setup({ databasePath, decide, pollIntervalMs: 10 });
      yield* waitFor(() => workers.length === 1);
      expect(workers[0]?.prompts[0]).toContain(FINDING);
      for (let round = 2; round <= 3; round++) {
        workers.at(-1)?.complete(`fixed, try ${round}`);
        yield* waitFor(() => workers.length === 2 * round - 2);
        workers.at(-1)?.complete(FINDING);
        yield* waitFor(() => workers.length === 2 * round - 1);
      }
      workers.at(-1)?.complete("fixed, try 4");
      yield* waitFor(() => workers.length === 6);
      workers.at(-1)?.complete(FINDING);
      yield* waitFor(() => taskStatus(orchestrator, first.task.id) === "failed");
      expect(workers).toHaveLength(6);
      yield* Effect.promise(() => orchestrator.dispose());
      yield* removePath(directory);
    }),
  );

it(
  "keeps a failed review's findings and its rounds of fixes when the orchestrator reopens",
  keepsTheFindingsAndTheRoundsAcrossARestart,
);
