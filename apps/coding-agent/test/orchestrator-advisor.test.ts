import testing from "@msa/testing";
import { Effect } from "effect";
import { expect, it } from "vite-plus/test";

import orchestratorHarness from "./orchestrator-harness.ts";
import orchestratorSupport from "./orchestrator-support.ts";
import triageSupport from "./triage-support.ts";
import worktreeSupport from "./worktree-support.ts";

const { joinPath, pathExists, readTextFile, writeTextFile } = testing;
const { create } = orchestratorSupport;
const { harness } = orchestratorHarness;
const { setup, taskStatus, waitFor } = harness;
const { sh, withRepository } = worktreeSupport;
const { escalateTriage } = triageSupport;

const REQUEST = {
  options: [
    { choice: "Keep the old API and add the new one beside it", tradeoffs: "Two APIs to keep" },
    { choice: "Drop the old API", tradeoffs: "Breaks callers outside the goal" },
  ],
  unmet: "The goal asks to remove the old API and to keep every caller working; both cannot hold.",
};

const waitingTask = (repository: string) =>
  Effect.gen(function* () {
    const setUp = setup({ cwd: repository });
    const task = yield* create(setUp.orchestrator, {
      currentState: "the old API is used by every caller",
      goalState: "the old API is gone and every caller still works",
      title: "remove the old API",
    });
    const worker = setUp.workers[0]!;
    yield* Effect.promise(() =>
      expect(setUp.orchestrator.advise(task.id)).rejects.toThrow("waits for a decision"),
    );
    yield* writeTextFile(joinPath(worker.cwd, "draft.txt"), "uncommitted draft\n");
    yield* Effect.promise(() => worker.requestDecision(REQUEST));
    yield* escalateTriage(setUp.workers);
    yield* waitFor(() => taskStatus(setUp.orchestrator, task.id) === "needs-decision");
    return { ...setUp, task, worker };
  });

const consultsAReadOnlyAdvisor = () =>
  Effect.runPromise(
    withRepository((repository) =>
      Effect.gen(function* () {
        const { orchestrator, reports, task, worker, workers } = yield* waitingTask(repository);
        yield* Effect.promise(() => orchestrator.advise(task.id, "Which callers break?"));
        yield* waitFor(() => workers.length === 3);
        const advisor = workers[2]!;
        expect(advisor.readOnly).toBe(true);
        expect(advisor.tools).toEqual([]);
        expect(advisor.cwd).not.toBe(worker.cwd);
        expect(yield* readTextFile(joinPath(advisor.cwd, "draft.txt"))).toBe("uncommitted draft\n");
        expect(yield* sh("git status --porcelain", advisor.cwd)).toBe("");
        expect(yield* sh("git branch --show-current", advisor.cwd)).toBe("");
        expect(advisor.prompts[0]).toContain(REQUEST.unmet);
        expect(advisor.prompts[0]).toContain("Which callers break?");
        expect(advisor.prompts[0]).toContain("+uncommitted draft");
        expect(taskStatus(orchestrator, task.id)).toBe("needs-decision");

        advisor.complete("Recommend keeping the old API: three callers outside the goal break.");
        yield* waitFor(() => reports.at(-1)?.details.role === "advisor");
        expect(reports.at(-1)?.details.status).toBe("needs-decision");
        expect(reports.at(-1)?.text).toContain("three callers outside the goal break");
        expect(taskStatus(orchestrator, task.id)).toBe("needs-decision");
        expect(yield* pathExists(advisor.cwd)).toBe(false);
        expect(yield* sh("git status --porcelain", worker.cwd)).toBe("?? draft.txt");

        yield* Effect.promise(() => orchestrator.sendMessage(task.id, "Keep the old API."));
        yield* waitFor(() => worker.prompts.length === 2);
        expect(workers).toHaveLength(3);
      }),
    ),
  );

it(
  "runs an advisor with only read tools in a detached checkout of the worker's current files, reports its advice, removes the checkout, and leaves the task waiting for the answer",
  consultsAReadOnlyAdvisor,
);

const stopsAnAdvisorOnceTheDecisionIsMade = () =>
  Effect.runPromise(
    withRepository((repository) =>
      Effect.gen(function* () {
        const { orchestrator, reports, task, worker, workers } = yield* waitingTask(repository);
        yield* Effect.promise(() => orchestrator.advise(task.id));
        yield* waitFor(() => workers.length === 3);
        const advisor = workers[2]!;
        const reported = reports.length;

        yield* Effect.promise(() => orchestrator.sendMessage(task.id, "Keep the old API."));
        yield* waitFor(() => worker.prompts.length === 2);
        expect(advisor.isStreaming).toBe(false);
        expect(yield* pathExists(advisor.cwd)).toBe(false);
        const view = yield* Effect.promise(() => orchestrator.read(task.id));
        const stopped = view.reports.find((report) => report.role === "advisor");
        expect(stopped?.status).toBe("stopped");
        expect(stopped?.content).toContain("stale");

        advisor.complete("late advice");
        yield* Effect.sleep(20);
        expect(reports.slice(reported).some((report) => report.text.includes("late advice"))).toBe(
          false,
        );
        expect(taskStatus(orchestrator, task.id)).toBe("running");
      }),
    ),
  );

it(
  "stops a running advisor and removes its checkout when the orchestrator answers the decision first, so no stale advice arrives",
  stopsAnAdvisorOnceTheDecisionIsMade,
);
