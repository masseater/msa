import { Effect } from "effect";
import { expect, it } from "vite-plus/test";

import type orchestratorTypes from "../src/core/orchestrator/orchestrator.types.ts";
import orchestratorHarness from "./orchestrator-harness.ts";
import orchestratorReplanSupport from "./orchestrator-replan-support.ts";

const { create } = orchestratorReplanSupport;
const { harness } = orchestratorHarness;
const { setup, taskStatus, waitFor } = harness;

type Orchestrator = orchestratorTypes.Orchestrator;

const work = (title: string) => ({
  currentState: `${title} is not written`,
  goalState: `${title} works`,
  title,
});

function roundReview(orchestrator: Orchestrator): orchestratorTypes.TaskView {
  const review = orchestrator.snapshot.tasks.find((task) => task.kind === "review");
  if (review === undefined) throw new Error("the round has no review");
  return review;
}

function reviewerThreads(orchestrator: Orchestrator, taskId: string): number {
  return orchestrator.snapshot.tasks
    .filter((task) => task.id === taskId)
    .flatMap((task) => task.assignments)
    .filter((assignment) => assignment.role === "reviewer").length;
}

function runningThreadOf(orchestrator: Orchestrator, taskId: string): string | undefined {
  const running = new Set(
    orchestrator.snapshot.threads
      .filter((thread) => thread.status === "running")
      .map((thread) => thread.id),
  );
  return orchestrator.snapshot.tasks
    .find((task) => task.id === taskId)
    ?.assignments.find((assignment) => running.has(assignment.threadId))?.threadId;
}

function finish(
  orchestrator: Orchestrator,
  workers: { complete: (reply: string) => void }[],
  taskId: string,
  worker: number,
) {
  return Effect.gen(function* () {
    const before = workers.length;
    workers[worker]?.complete(`${taskId} done`);
    yield* waitFor(() => workers.length > before);
    workers[before]?.complete(`${taskId} reviewed`);
    yield* waitFor(() => taskStatus(orchestrator, taskId) === "completed");
  });
}

it("keeps the round review waiting when a task of the round is stopped and then replaced, until the replacement completes", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator, workers } = setup();
      const a = yield* create(orchestrator, work("a"));
      const b = yield* create(orchestrator, work("b"));
      yield* waitFor(() => workers.length === 2);
      yield* finish(orchestrator, workers, a.id, 0);
      const review = roundReview(orchestrator).id;

      yield* Effect.promise(() => orchestrator.stop(b.id));
      expect(taskStatus(orchestrator, review)).toBe("waiting");
      expect(reviewerThreads(orchestrator, review)).toBe(0);

      const replanned = yield* Effect.promise(() =>
        orchestrator.replan({
          reason: "b runs in the wrong place",
          stop: false,
          tasks: [{ ...work("b again"), from: [b.id] }],
        }),
      );
      const heir = replanned.created[0]!.taskId;
      expect(roundReview(orchestrator).dependsOn).toContain(heir);
      expect(roundReview(orchestrator).dependsOn).not.toContain(b.id);
      expect(taskStatus(orchestrator, review)).toBe("waiting");
      expect(reviewerThreads(orchestrator, review)).toBe(0);

      yield* waitFor(() => taskStatus(orchestrator, heir) === "running");
      yield* finish(orchestrator, workers, heir, workers.length - 1);
      yield* waitFor(() => reviewerThreads(orchestrator, review) === 1);
      expect(taskStatus(orchestrator, review)).toBe("running");
    }),
  ));

it("stops a running round review and makes it wait when a replan gives the round a new task", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator, workers } = setup();
      const a = yield* create(orchestrator, work("a"));
      yield* finish(orchestrator, workers, a.id, 0);
      const review = roundReview(orchestrator).id;
      yield* waitFor(() => taskStatus(orchestrator, review) === "running");
      const thread = runningThreadOf(orchestrator, review);

      const replanned = yield* Effect.promise(() =>
        orchestrator.replan({
          reason: "the round needs one more change",
          stop: false,
          tasks: [work("c")],
        }),
      );
      const added = replanned.created[0]!.taskId;
      expect(roundReview(orchestrator).dependsOn).toContain(added);
      expect(taskStatus(orchestrator, review)).toBe("waiting");
      expect(orchestrator.snapshot.threads.find((item) => item.id === thread)?.status).toBe(
        "stopped",
      );

      yield* waitFor(() => taskStatus(orchestrator, added) === "running");
      yield* finish(orchestrator, workers, added, workers.length - 1);
      yield* waitFor(() => reviewerThreads(orchestrator, review) === 2);
      expect(taskStatus(orchestrator, review)).toBe("running");
    }),
  ));

it("stops a running round review and makes it wait when create_task adds a task to the round", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator, workers } = setup();
      const a = yield* create(orchestrator, work("a"));
      yield* finish(orchestrator, workers, a.id, 0);
      const review = roundReview(orchestrator).id;
      yield* waitFor(() => taskStatus(orchestrator, review) === "running");

      const added = yield* create(orchestrator, work("c"));
      expect(roundReview(orchestrator).dependsOn).toContain(added.id);
      expect(taskStatus(orchestrator, review)).toBe("waiting");
      expect(runningThreadOf(orchestrator, review)).toBeUndefined();

      yield* waitFor(() => taskStatus(orchestrator, added.id) === "running");
      yield* finish(orchestrator, workers, added.id, workers.length - 1);
      yield* waitFor(() => reviewerThreads(orchestrator, review) === 2);
      expect(taskStatus(orchestrator, review)).toBe("running");
    }),
  ));

it("stops a running round review and makes it wait when set_task_depends adds an unfinished dependency", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator, workers } = setup({ maxConcurrent: 1 });
      const a = yield* create(orchestrator, work("a"));
      yield* finish(orchestrator, workers, a.id, 0);
      const review = roundReview(orchestrator).id;
      yield* waitFor(() => taskStatus(orchestrator, review) === "running");
      const other = yield* create(orchestrator, { ...work("other"), round: "later" });
      expect(taskStatus(orchestrator, other.id)).toBe("waiting");

      yield* Effect.promise(() => orchestrator.setDepends({ add: [other.id], taskIds: [review] }));
      expect(taskStatus(orchestrator, review)).toBe("waiting");
      expect(runningThreadOf(orchestrator, review)).toBeUndefined();

      yield* waitFor(() => taskStatus(orchestrator, other.id) === "running");
      yield* finish(orchestrator, workers, other.id, workers.length - 1);
      yield* waitFor(() => reviewerThreads(orchestrator, review) === 2);
      expect(taskStatus(orchestrator, review)).toBe("running");
    }),
  ));

it("stops a running task review and makes the task wait when set_task_depends adds an unfinished dependency", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator, workers } = setup({ maxConcurrent: 1 });
      const a = yield* create(orchestrator, work("a"));
      workers[0]?.complete("a done");
      yield* waitFor(() => workers.length === 2);
      expect(reviewerThreads(orchestrator, a.id)).toBe(1);
      const before = yield* create(orchestrator, { ...work("before a"), round: "later" });

      yield* Effect.promise(() => orchestrator.setDepends({ add: [before.id], taskIds: [a.id] }));
      expect(taskStatus(orchestrator, a.id)).toBe("waiting");
      expect(runningThreadOf(orchestrator, a.id)).toBeUndefined();

      yield* waitFor(() => taskStatus(orchestrator, before.id) === "running");
      yield* finish(orchestrator, workers, before.id, workers.length - 1);
      yield* waitFor(() => taskStatus(orchestrator, a.id) === "running");
    }),
  ));

it("still refuses to give a running worker an unfinished dependency", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator } = setup({ maxConcurrent: 1 });
      const a = yield* create(orchestrator, work("a"));
      const b = yield* create(orchestrator, { ...work("b"), round: "later" });
      const refused = yield* Effect.promise(() =>
        orchestrator.setDepends({ add: [b.id], taskIds: [a.id] }).then(
          () => "",
          (error: unknown) => (error instanceof Error ? error.message : String(error)),
        ),
      );
      expect(refused).toContain("stop_task");
      expect(taskStatus(orchestrator, a.id)).toBe("running");
    }),
  ));
