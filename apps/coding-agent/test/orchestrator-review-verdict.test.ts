import type aiTypes from "@msa/ai/index.types";
import testing from "@msa/testing";
import { Effect } from "effect";
import { expect, it } from "vite-plus/test";

import orchestratorHarness from "./orchestrator-harness.ts";
import orchestratorSupport from "./orchestrator-support.ts";
import reviewVerdictSupport from "./review-verdict-support.ts";
import triageSupport from "./triage-support.ts";

const { joinPath, makeDirectory, makeTempDir, removePath } = testing;
const { escalateTriage, runningTriage } = triageSupport;
const { create } = orchestratorSupport;
const { harness } = orchestratorHarness;
const { setup, taskStatus, waitFor } = harness;
const { classifierDecide, reportOf } = reviewVerdictSupport;

const FINDING = "Within the goal: the second read is not covered by a test.";

const GOAL = "repeated reads hit the cache and a test covers the second read";

const MANY_ROUNDS = 5;

function previousOf(state: aiTypes.JsonObject): string {
  return typeof state["previousReport"] === "string" ? state["previousReport"] : "";
}

function findingsFail(seen: aiTypes.JsonObject[] = []) {
  return classifierDecide({
    progress: (state) =>
      reportOf(state).includes(FINDING) && previousOf(state).includes(FINDING)
        ? { moving: 0.1, stuck: 0.9 }
        : { moving: 0.9, stuck: 0.1 },
    verdict: (state) => {
      seen.push(state);
      return reportOf(state).includes("Within the goal:")
        ? { fail: 0.9, pass: 0.1 }
        : { fail: 0.1, pass: 0.9 };
    },
  });
}

const startCacheTask = (
  decide: ReturnType<typeof classifierDecide>,
  where: { databasePath?: string; cwd?: string } = {},
) =>
  Effect.gen(function* () {
    const setUp = setup({ ...where, decide });
    const task = yield* create(setUp.orchestrator, {
      currentState: "repeated reads go to the network",
      goalState: GOAL,
      title: "cache reads",
    });
    setUp.workers[0]?.complete("added the cache");
    yield* waitFor(() => setUp.workers.length === 2);
    return { ...setUp, task };
  });

type Reported = ReturnType<typeof setup>["reports"];

const expectReported = (reports: Reported, status: string, verdict: string) => {
  const last = reports.at(-1);
  expect(last?.details.status).toBe(status);
  expect(last?.text.split("\n\n")[0]).toBe(`cache reads (reviewer) ${status}.`);
  expect(last?.text).toContain(`<report>\nReview verdict: ${verdict} (`);
};

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
      expect(reports.at(-1)?.details).toMatchObject({ started: [task.id], status: "sent-back" });
      expectReported(reports, "sent-back", "fail");

      workers[2]?.complete("covered the second read");
      yield* waitFor(() => workers.length === 4);
      expect(workers[3]?.prompts[0]).toContain("covered the second read");
      workers[3]?.complete("Acceptable. Nothing within the goal remains.");
      yield* waitFor(() => taskStatus(orchestrator, task.id) === "completed");
      const passed = yield* Effect.promise(() => orchestrator.read(task.id));
      expect(passed.reports.at(-1)?.content).toContain("pass 0.90");
      expectReported(reports, "completed", "pass");
    }),
  );

it(
  "sends a review that leaves findings within the goal back to the worker and completes the task only after a passing review",
  sendsAFailedReviewBackToTheWorker,
);

const keepsSendingBackWhileTheFindingsMove = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const seen: aiTypes.JsonObject[] = [];
      const { orchestrator, task, workers } = yield* startCacheTask(findingsFail(seen));
      for (let round = 1; round <= MANY_ROUNDS; round++) {
        workers.at(-1)?.complete(`Within the goal: problem number ${round} remains.`);
        yield* waitFor(() => workers.length === 2 * round + 1);
        expect(taskStatus(orchestrator, task.id)).toBe("running");
        workers.at(-1)?.complete(`fixed problem ${round}`);
        yield* waitFor(() => workers.length === 2 * round + 2);
      }
      expect(seen.at(-1)?.["previousReport"]).toContain("problem number 4");
      workers.at(-1)?.complete("Acceptable. Nothing within the goal remains.");
      yield* waitFor(() => taskStatus(orchestrator, task.id) === "completed");
    }),
  );

it(
  "keeps sending a failing review back for as many rounds as its findings keep changing, and completes the task once a review passes",
  keepsSendingBackWhileTheFindingsMove,
);

const asksForADecisionWhenTheReviewRepeats = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const cwd = yield* makeTempDir("msa-review-verdict-");
      const { orchestrator, reports, task, workers } = yield* startCacheTask(findingsFail(), {
        cwd,
      });
      workers[1]?.complete(FINDING);
      yield* waitFor(() => workers.length === 3);
      workers[2]?.complete("tried to cover the second read");
      yield* waitFor(() => workers.length === 4);
      workers[3]?.complete(`Still not acceptable.\n${FINDING}`);
      yield* escalateTriage(workers);
      yield* waitFor(() => taskStatus(orchestrator, task.id) === "needs-decision");
      expect(workers).toHaveLength(5);
      expect(reports.at(-1)?.details).toMatchObject({ role: "triage", status: "needs-decision" });
      expect(reports.at(-1)?.text).toContain("Review verdict: fail (");
      expect(reports.at(-1)?.text).toContain("the work is not moving");

      yield* Effect.promise(() =>
        orchestrator.sendMessage(task.id, "Cover the second read with an integration test."),
      );
      yield* waitFor(() => workers[2]?.prompts.length === 2);
      expect(workers).toHaveLength(5);
      expect(taskStatus(orchestrator, task.id)).toBe("running");
      expect(workers[2]?.prompts[1]).toContain("Cover the second read with an integration test.");
      expect(workers[2]?.prompts[1]).toContain(FINDING);
      yield* Effect.promise(() => orchestrator.dispose());
      yield* removePath(cwd);
    }),
  );

it(
  "waits for a decision when a review repeats the previous review's findings unfixed, and continues the worker's thread with the decision",
  asksForADecisionWhenTheReviewRepeats,
);

const JUDGE_AGAIN = {
  conclusion: "decided",
  decision: "Record each goal item from the diff again and end the turn with the report.",
  goalItems: [{ how: "The diff shows the cache and its test; the reviewer records it.", item: 1 }],
  grounds: "The work is in the diff; only the judgement is missing.",
};

const undecidedReview = (decide: ReturnType<typeof classifierDecide>) =>
  Effect.gen(function* () {
    const setUp = yield* startCacheTask(decide);
    setUp.workers[1]?.complete("Acceptable. Nothing within the goal remains.");
    yield* waitFor(() => runningTriage(setUp.workers) !== undefined);
    expect(taskStatus(setUp.orchestrator, setUp.task.id)).toBe("running");
    expect(setUp.reports.at(-1)?.details).toMatchObject({ role: "reviewer", status: "waiting" });
    expect(setUp.reports.at(-1)?.text).toContain("<report>\nReview verdict: undecided (");
    return { ...setUp, triage: runningTriage(setUp.workers)! };
  });

const doesNotCompleteAnUndecidedReview =
  (decide: ReturnType<typeof classifierDecide>, reason: string) => () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { orchestrator, reports, task, triage, workers } = yield* undecidedReview(decide);
        expect(triage.prompts[0]).toContain(reason);
        yield* Effect.promise(() => triage.escalate());
        yield* waitFor(() => taskStatus(orchestrator, task.id) === "needs-decision");
        yield* Effect.sleep(20);
        expect(taskStatus(orchestrator, task.id)).toBe("needs-decision");
        expect(workers).toHaveLength(3);
        expect(reports.at(-1)?.details).toMatchObject({ role: "triage", status: "needs-decision" });
        expect(reports.at(-1)?.text).toContain(reason);
        const view = yield* Effect.promise(() => orchestrator.read(task.id));
        expect(view.reports.some((report) => report.content.includes("undecided"))).toBe(true);

        yield* Effect.promise(() =>
          orchestrator.sendMessage(task.id, "The cache test is in the diff; judge it again."),
        );
        yield* waitFor(() => workers[1]?.prompts.length === 2);
        expect(workers).toHaveLength(3);
        expect(workers[1]?.prompts[1]).toContain("The cache test is in the diff; judge it again.");
      }),
    );

it(
  "waits for a decision instead of completing the task when the decision model is unavailable and the triage finds a human must decide, and continues the reviewer with the answer",
  doesNotCompleteAnUndecidedReview(
    classifierDecide({ unavailable: "the classifier backend cannot load" }),
    "the classifier backend cannot load",
  ),
);

it(
  "waits for a decision instead of completing the task when no verdict reaches the threshold and the triage finds a human must decide",
  doesNotCompleteAnUndecidedReview(
    classifierDecide(() => ({ fail: 0.4, pass: 0.6 })),
    "no answer reached the threshold",
  ),
);

const continuesTheReviewerWithTheTriage = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator, reports, task, triage, workers } = yield* undecidedReview(
        classifierDecide({ unavailable: "the classifier backend cannot load" }),
      );
      yield* Effect.promise(() => triage.concludeTriage(JUDGE_AGAIN));
      yield* waitFor(() => workers[1]?.prompts.length === 2);
      expect(workers[1]?.prompts[1]).toContain(JUDGE_AGAIN.decision);
      expect(taskStatus(orchestrator, task.id)).toBe("running");
      expect(reports.map((report) => report.details.status)).not.toContain("needs-decision");
    }),
  );

it(
  "continues the reviewer with the triage's decision, without asking a human, when the review cannot be judged",
  continuesTheReviewerWithTheTriage,
);

const judgesAgainstTheFindingsBeforeARestart = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* makeTempDir("msa-review-verdict-");
      const databasePath = `${directory}/orchestrator.db`;
      const cwd = joinPath(directory, "work");
      yield* makeDirectory(cwd);
      const decide = findingsFail();
      const first = yield* startCacheTask(decide, { cwd, databasePath });
      first.workers[1]?.complete(FINDING);
      yield* waitFor(() => first.workers.length === 3);
      yield* Effect.promise(() => first.orchestrator.dispose());

      const { orchestrator, reports, workers } = setup({
        cwd,
        databasePath,
        decide,
        pollIntervalMs: 10,
      });
      yield* waitFor(() => workers.length === 1);
      expect(workers[0]?.prompts[0]).toContain(FINDING);
      workers[0]?.complete("tried again");
      yield* waitFor(() => workers.length === 2);
      workers[1]?.complete(FINDING);
      yield* escalateTriage(workers);
      yield* waitFor(() => taskStatus(orchestrator, first.task.id) === "needs-decision");
      expect(reports.at(-1)?.details.status).toBe("needs-decision");
      yield* Effect.promise(() => orchestrator.dispose());
      yield* removePath(directory);
    }),
  );

it(
  "keeps a failed review's findings when the orchestrator reopens, and compares the next review with them",
  judgesAgainstTheFindingsBeforeARestart,
);
