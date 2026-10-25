import type aiTypes from "@msa/ai/index.types";
import { Effect } from "effect";
import { expect, it } from "vite-plus/test";

import orchestratorHarness from "./orchestrator-harness.ts";
import orchestratorSupport from "./orchestrator-support.ts";
import pullRequestSupport from "./pull-request-support.ts";
import reviewVerdictSupport from "./review-verdict-support.ts";
import triageSupport from "./triage-support.ts";
import worktreeSupport from "./worktree-support.ts";

const { create } = orchestratorSupport;
const { harness } = orchestratorHarness;
const { setup, taskStatus, waitFor } = harness;
const { classifierDecide, reportOf } = reviewVerdictSupport;
const { commitAndPush, withRemote } = pullRequestSupport;
const { runCommand, shortId } = worktreeSupport;
const { escalateTriage } = triageSupport;

const REQUEST = {
  options: [
    { choice: "Keep the old API and add the new one beside it", tradeoffs: "Two APIs to keep" },
    { choice: "Drop the old API", tradeoffs: "Breaks callers outside the goal" },
  ],
  recommendation: "Keep the old API",
  unmet: "The goal asks to remove the old API and to keep every caller working; both cannot hold.",
};

const startTwoTasks = () =>
  Effect.gen(function* () {
    const setUp = setup();
    const first = yield* create(setUp.orchestrator, {
      currentState: "the old API is used by every caller",
      goalState: "the old API is gone and every caller still works",
      title: "remove the old API",
    });
    const second = yield* create(setUp.orchestrator, {
      currentState: "the docs describe the old API",
      dependsOn: [first.id],
      goalState: "the docs describe the new API",
      title: "update the docs",
    });
    return { ...setUp, first, second };
  });

const waitsForADecisionTheWorkerAsksFor = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator, reports, workers, first, second } = yield* startTwoTasks();
      yield* Effect.promise(() => workers[0]!.requestDecision(REQUEST, "Stopping for a decision."));
      yield* escalateTriage(workers);
      yield* waitFor(() => taskStatus(orchestrator, first.id) === "needs-decision");
      yield* Effect.sleep(20);
      expect(workers).toHaveLength(2);
      expect(taskStatus(orchestrator, second.id)).toBe("waiting");
      expect(reports.at(-1)?.details).toMatchObject({
        role: "triage",
        status: "needs-decision",
        taskId: first.id,
      });
      expect(reports.at(-1)?.text).toContain(REQUEST.unmet);
      expect(reports.at(-1)?.text).toContain("Drop the old API");
      const listed = yield* Effect.promise(() => orchestrator.list());
      expect(listed.find((task) => task.id === first.id)?.status).toBe("needs-decision");
      const read = yield* Effect.promise(() => orchestrator.read(first.id));
      expect(read.reports.at(-1)?.content).toContain(REQUEST.unmet);

      yield* Effect.promise(() =>
        orchestrator.sendMessage(first.id, "Keep the old API; the user agreed to narrow the goal."),
      );
      yield* waitFor(() => workers[0]!.prompts.length === 2);
      expect(workers).toHaveLength(2);
      expect(taskStatus(orchestrator, first.id)).toBe("running");
      expect(workers[0]!.prompts[1]).toContain("Keep the old API; the user agreed");
      expect(workers[0]!.prompts[1]).toContain(REQUEST.unmet);

      workers[0]!.complete("kept the old API");
      yield* waitFor(() => workers.length === 3);
      workers[2]!.complete("Acceptable.");
      yield* waitFor(() => taskStatus(orchestrator, first.id) === "completed");
      yield* waitFor(() => workers.length === 4);
      expect(taskStatus(orchestrator, second.id)).toBe("running");
    }),
  );

it(
  "keeps a task whose worker asks for a decision out of review, completion, and its dependents, and continues the same thread with the orchestrator's answer",
  waitsForADecisionTheWorkerAsksFor,
);

const waitsForADecisionTheReviewerAsksFor = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator, reports, workers, first } = yield* startTwoTasks();
      workers[0]!.complete("removed the old API");
      yield* waitFor(() => workers.length === 2);
      yield* Effect.promise(() => workers[1]!.requestDecision(REQUEST));
      yield* escalateTriage(workers);
      yield* waitFor(() => taskStatus(orchestrator, first.id) === "needs-decision");
      expect(reports.at(-1)?.details).toMatchObject({ role: "triage", status: "needs-decision" });
      expect(reports.at(-1)?.text).toContain("Decision requested by the reviewer");

      yield* Effect.promise(() =>
        orchestrator.sendMessage(first.id, "Judge it with the old API kept."),
      );
      yield* waitFor(() => workers[1]!.prompts.length === 2);
      expect(workers).toHaveLength(3);
      expect(workers[1]!.prompts[1]).toContain("Judge it with the old API kept.");
      workers[1]!.complete("Acceptable.");
      yield* waitFor(() => taskStatus(orchestrator, first.id) === "completed");
    }),
  );

it(
  "keeps a task whose reviewer asks for a decision from passing, and continues the reviewer's thread with the answer",
  waitsForADecisionTheReviewerAsksFor,
);

const unmetGoal = (state: aiTypes.JsonObject) => {
  const body = typeof state["pullRequestBody"] === "string" ? state["pullRequestBody"] : "";
  const unmet = `${reportOf(state)}\n${body}`.includes("Known limitation");
  return unmet ? { met: 0.1, unmet: 0.9 } : { met: 0.9, unmet: 0.1 };
};

const passingVerdictWithUnmetGoal = classifierDecide({
  goal: unmetGoal,
  verdict: () => ({ fail: 0.1, pass: 0.9 }),
});

const doesNotPassAKnownLimitationInTheReport = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator, reports, workers } = setup({ decide: passingVerdictWithUnmetGoal });
      const task = yield* create(orchestrator, {
        currentState: "repeated reads go to the network",
        goalState: "repeated reads hit the cache",
        title: "cache reads",
      });
      workers[0]!.complete("added the cache");
      yield* waitFor(() => workers.length === 2);
      workers[1]!.complete("Acceptable. Known limitation: the second read still goes out.");
      yield* waitFor(() => workers.length === 3);
      expect(taskStatus(orchestrator, task.id)).toBe("running");
      expect(reports.at(-1)?.details.status).toBe("sent-back");
      expect(reports.at(-1)?.text).toContain("Review verdict: fail");
      expect(workers[2]!.prompts[0]).toContain("Known limitation");
    }),
  );

it(
  "sends work back instead of passing it when the reviewer passes it with a goal item left as a known limitation",
  doesNotPassAKnownLimitationInTheReport,
);

const doesNotMergeAKnownLimitationInThePullRequest = () =>
  Effect.runPromise(
    withRemote((remote) =>
      Effect.gen(function* () {
        const { github, repository } = remote;
        const seen: aiTypes.JsonObject[] = [];
        const decide = classifierDecide({
          goal: (state) => {
            seen.push(state);
            return unmetGoal(state);
          },
          verdict: () => ({ fail: 0.1, pass: 0.9 }),
        });
        const { orchestrator, workers } = setup({
          cwd: repository,
          decide,
          runCommand,
          runGh: github.runGh,
        });
        const task = yield* create(orchestrator, {
          currentState: "feature.txt is missing",
          goalState: "feature.txt exists on main and is documented",
          title: "feature",
        });
        const branch = `task/${shortId(task.id)}`;
        yield* commitAndPush(workers[0]!.cwd, "feature.txt", branch);
        yield* github.open(
          branch,
          "main",
          "Adds feature.txt.\n\nKnown limitation: not documented.",
        );
        github.ci.set(yield* github.head(branch), "success");
        workers[0]!.complete("opened the pull request");
        yield* waitFor(() => workers.length === 2);
        workers[1]!.complete("Acceptable.");
        yield* waitFor(() => workers.length === 3);
        expect(seen.at(-1)?.["pullRequestBody"]).toContain("Known limitation: not documented.");
        expect(github.merged).toEqual([]);
        expect(taskStatus(orchestrator, task.id)).toBe("running");
      }),
    ),
  );

it(
  "does not merge a pull request whose body leaves a goal item as a known limitation, even when the reviewer passes it",
  doesNotMergeAKnownLimitationInThePullRequest,
);
