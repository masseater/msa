import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import type orchestratorTypes from "../src/core/orchestrator/orchestrator.types.ts";
import orchestratorHarness from "./orchestrator-harness.ts";
import orchestratorReplanSupport from "./orchestrator-replan-support.ts";

const { runTest } = testing;
const { create } = orchestratorReplanSupport;
const { harness } = orchestratorHarness;
const { setup, taskStatus, waitFor } = harness;

type Orchestrator = orchestratorTypes.Orchestrator;

const work = (title: string) => ({
  currentState: `${title} is not written`,
  goalState: `${title} works`,
  title,
});

const paths = {
  replan: (orchestrator: Orchestrator, taskId: string, dependency: string) => {
    const current = orchestrator.snapshot.tasks.find((task) => task.id === taskId)?.dependsOn ?? [];
    return orchestrator
      .replan({
        reason: `${taskId} needs ${dependency}`,
        rewire: [{ dependsOn: [...current, dependency], taskId }],
        stop: false,
      })
      .then(() => undefined);
  },
  set_task_depends: (orchestrator: Orchestrator, taskId: string, dependency: string) =>
    orchestrator.setDepends({ add: [dependency], taskIds: [taskId] }).then(() => undefined),
};

type Path = keyof typeof paths;

function addDependency(path: Path, orchestrator: Orchestrator, taskId: string, dependency: string) {
  return Effect.promise(() =>
    paths[path](orchestrator, taskId, dependency).then(
      () => "",
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    ),
  );
}

function dependsOn(orchestrator: Orchestrator, taskId: string): readonly string[] {
  return orchestrator.snapshot.tasks.find((task) => task.id === taskId)?.dependsOn ?? [];
}

function runningRole(orchestrator: Orchestrator, taskId: string): string | undefined {
  const running = new Set(
    orchestrator.snapshot.threads
      .filter((thread) => thread.status === "running")
      .map((thread) => thread.id),
  );
  return orchestrator.snapshot.tasks
    .find((task) => task.id === taskId)
    ?.assignments.find((assignment) => running.has(assignment.threadId))?.role;
}

const refusesAnUnfinishedDependencyForARunningWorker = (path: Path) =>
  runTest(
    Effect.gen(function* () {
      const { orchestrator } = setup({ maxConcurrent: 1 });
      const a = yield* create(orchestrator, work("a"));
      const b = yield* create(orchestrator, { ...work("b"), round: "later" });
      yield* waitFor(() => runningRole(orchestrator, a.id) === "worker");

      const refused = yield* addDependency(path, orchestrator, a.id, b.id);
      expect(refused).toContain(
        `${a.id} is running, so it can only gain a dependency that already finished`,
      );
      expect(refused).toContain("stop_task");
      expect(dependsOn(orchestrator, a.id)).toEqual([]);
      expect(taskStatus(orchestrator, a.id)).toBe("running");
      expect(runningRole(orchestrator, a.id)).toBe("worker");
    }),
  );

const givesARunningWorkerAFinishedDependency = (path: Path) =>
  runTest(
    Effect.gen(function* () {
      const { orchestrator, workers } = setup();
      const done = yield* create(orchestrator, work("done"));
      const a = yield* create(orchestrator, work("a"));
      yield* waitFor(() => workers.length === 2);
      workers[0]?.complete("done done");
      yield* waitFor(() => workers.length === 3);
      workers[2]?.complete("done reviewed");
      yield* waitFor(() => taskStatus(orchestrator, done.id) === "completed");
      expect(runningRole(orchestrator, a.id)).toBe("worker");

      const refused = yield* addDependency(path, orchestrator, a.id, done.id);
      expect(refused).toBe("");
      expect(dependsOn(orchestrator, a.id)).toEqual([done.id]);
      expect(taskStatus(orchestrator, a.id)).toBe("running");
      expect(runningRole(orchestrator, a.id)).toBe("worker");
    }),
  );

const holdsARunningReviewOnAnUnfinishedDependency = (path: Path) =>
  runTest(
    Effect.gen(function* () {
      const { orchestrator, workers } = setup({ maxConcurrent: 1 });
      const a = yield* create(orchestrator, work("a"));
      workers[0]?.complete("a done");
      yield* waitFor(() => runningRole(orchestrator, a.id) === "reviewer");
      const before = yield* create(orchestrator, { ...work("before a"), round: "later" });

      const refused = yield* addDependency(path, orchestrator, a.id, before.id);
      expect(refused).toBe("");
      expect(dependsOn(orchestrator, a.id)).toEqual([before.id]);
      expect(taskStatus(orchestrator, a.id)).toBe("waiting");
      expect(runningRole(orchestrator, a.id)).toBeUndefined();
    }),
  );

const drops = {
  "replan drop": (orchestrator: Orchestrator, _taskId: string, dependency: string) =>
    orchestrator.replan({
      drop: [{ reason: `${dependency} is not needed`, taskId: dependency }],
      reason: `drop ${dependency}`,
      stop: false,
    }),
  "replan from": (orchestrator: Orchestrator, _taskId: string, dependency: string) =>
    orchestrator.replan({
      reason: `redo ${dependency}`,
      stop: false,
      tasks: [{ ...work("redo"), from: [dependency] }],
    }),
  "replan rewire": (orchestrator: Orchestrator, taskId: string) =>
    orchestrator.replan({
      reason: `${taskId} needs nothing`,
      rewire: [{ dependsOn: [], taskId }],
      stop: false,
    }),
  set_task_depends: (orchestrator: Orchestrator, taskId: string, dependency: string) =>
    orchestrator.setDepends({ remove: [dependency], taskIds: [taskId] }),
};

type Drop = keyof typeof drops;

const refusesToMoveADependencyOfARunningWorker = (path: Drop) =>
  runTest(
    Effect.gen(function* () {
      const { orchestrator, workers } = setup();
      const done = yield* create(orchestrator, work("done"));
      const a = yield* create(orchestrator, { ...work("a"), dependsOn: [done.id] });
      yield* waitFor(() => workers.length === 1);
      workers[0]?.complete("done done");
      yield* waitFor(() => workers.length === 2);
      workers[1]?.complete("done reviewed");
      yield* waitFor(() => runningRole(orchestrator, a.id) === "worker");

      const refused = yield* Effect.promise(() =>
        drops[path](orchestrator, a.id, done.id).then(
          () => "",
          (error: unknown) => (error instanceof Error ? error.message : String(error)),
        ),
      );
      expect(refused).toContain(`${a.id} is running. Stop it with stop_task`);
      expect(dependsOn(orchestrator, a.id)).toEqual([done.id]);
      expect(taskStatus(orchestrator, done.id)).toBe("completed");
      expect(taskStatus(orchestrator, a.id)).toBe("running");
      expect(runningRole(orchestrator, a.id)).toBe("worker");
    }),
  );

describe.each(["set_task_depends", "replan rewire", "replan from", "replan drop"] as const)(
  "%s on a dependency of a running worker",
  (path) => {
    it("refuses to drop or replace the dependency, and leaves the worker running on it", () =>
      refusesToMoveADependencyOfARunningWorker(path));
  },
);

describe.each(["set_task_depends", "replan"] as const)("%s on a running task", (path) => {
  it("refuses to give a running worker a dependency that has not finished, and leaves it running", () =>
    refusesAnUnfinishedDependencyForARunningWorker(path));
  it("gives a running worker a dependency that already finished and keeps it running", () =>
    givesARunningWorkerAFinishedDependency(path));
  it("stops a running review that gains a dependency that has not finished, and makes it wait", () =>
    holdsARunningReviewOnAnUnfinishedDependency(path));
});
