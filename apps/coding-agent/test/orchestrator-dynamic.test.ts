import { Effect, Result } from "effect";
import { expect, it } from "vite-plus/test";

import { orchestratorError } from "../src/core/orchestrator/errors.ts";
import type { Orchestrator } from "../src/core/orchestrator/orchestrator.ts";
import orchestratorHarness from "./orchestrator-harness.ts";

const { harness } = orchestratorHarness;

const { reviews, setup, taskStatus, waitFor } = harness;

const create = (orchestrator: Orchestrator, input: Parameters<Orchestrator["createTask"]>[0]) =>
  Effect.promise(() => orchestrator.createTask(input));

const waitsAgainForADependencyAddedAfter = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator, workers } = setup();
      const a = yield* create(orchestrator, {
        currentState: "a is not written",
        goalState: "a works",
        title: "a",
      });
      const c = yield* create(orchestrator, {
        currentState: "c is not written",
        goalState: "c works",
        title: "c",
      });
      const rejected = yield* Effect.result(
        Effect.tryPromise({
          catch: orchestratorError,
          try: () => orchestrator.setDepends({ add: [c.id], taskIds: [a.id] }),
        }),
      );
      expect(Result.isFailure(rejected)).toBe(true);
      expect(taskStatus(orchestrator, a.id)).toBe("running");

      yield* Effect.promise(() => orchestrator.stop(a.id));
      yield* Effect.promise(() => orchestrator.setDepends({ add: [c.id], taskIds: [a.id] }));
      yield* Effect.promise(() => orchestrator.rerun(a.id));
      workers[2]?.complete("a first pass");
      yield* waitFor(() => taskStatus(orchestrator, a.id) === "waiting");
      expect(
        orchestrator.snapshot.tasks.find((task) => task.id === a.id)?.waitingReason?.kind,
      ).toBe("dependencies");

      workers[1]?.complete("c done");
      yield* waitFor(() => workers.length === 4);
      workers[3]?.complete("c reviewed");
      yield* waitFor(() =>
        workers.some(
          (worker) =>
            worker.prompts[0]?.includes("a works") === true &&
            worker.prompts[0]?.includes("c reviewed") === true,
        ),
      );
      const again = workers.findLast((worker) => worker.prompts[0]?.includes("a works") === true);
      expect(again?.prompts[0]).toContain("c reviewed");
    }),
  );

it(
  "waits again for a dependency added after the task is stopped",
  waitsAgainForADependencyAddedAfter,
);

const startsReadyTasksInCreationOrderWithin = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator, workers } = setup({ maxConcurrent: 1 });
      const a = yield* create(orchestrator, {
        currentState: "a is not written",
        goalState: "a works",
        title: "a",
      });
      const b = yield* create(orchestrator, {
        currentState: "b is not written",
        goalState: "b works",
        title: "b",
      });
      const c = yield* create(orchestrator, {
        currentState: "c is not written",
        goalState: "c works",
        title: "c",
      });
      expect(workers).toHaveLength(1);
      expect(workers[0]?.prompts[0]).toContain("a works");

      workers[0]?.complete("a done");
      yield* waitFor(() => workers.length === 2);
      workers[1]?.complete("a reviewed");
      yield* waitFor(() => workers.length === 3);
      expect(taskStatus(orchestrator, a.id)).toBe("completed");
      expect(taskStatus(orchestrator, b.id)).toBe("running");
      expect(workers[2]?.prompts[0]).toContain("b works");
      expect(taskStatus(orchestrator, c.id)).toBe("waiting");
      expect(
        orchestrator.snapshot.tasks.find((task) => task.id === c.id)?.waitingReason?.kind,
      ).toBe("capacity");
    }),
  );

it(
  "starts ready tasks in creation order within the concurrency limit",
  startsReadyTasksInCreationOrderWithin,
);

const changesTheConcurrencyLimitWhileTasksWait = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator, workers } = setup({ maxConcurrent: 1 });
      yield* create(orchestrator, {
        currentState: "a is not written",
        goalState: "a works",
        title: "a",
      });
      yield* create(orchestrator, {
        currentState: "b is not written",
        goalState: "b works",
        title: "b",
      });
      yield* create(orchestrator, {
        currentState: "c is not written",
        goalState: "c works",
        title: "c",
      });
      expect(workers).toHaveLength(1);

      yield* Effect.promise(() => orchestrator.setMaxConcurrentThreads(3));
      yield* waitFor(() => workers.length === 3);
      expect(orchestrator.snapshot.maxConcurrentThreads).toBe(3);
    }),
  );

it("changes the concurrency limit while tasks wait", changesTheConcurrencyLimitWhileTasksWait);

const waitsForAnExternalCommandToExit = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      let checks = 0;
      const { orchestrator, workers } = setup({
        pollIntervalMs: 5,
        runCondition: () => {
          checks += 1;
          return Promise.resolve(checks >= 20);
        },
      });
      try {
        const task = yield* create(orchestrator, {
          condition: "check-external-state",
          currentState: "the branch is not merged",
          cwd: "/tmp",
          goalState: "the branch is merged and main is green",
          title: "merge",
        });
        expect(task.status).toBe("waiting");
        yield* Effect.sleep(20);
        expect(workers).toHaveLength(0);
        yield* waitFor(() => workers.length === 1);
        expect(workers[0]?.prompts[0]).toContain("the branch is not merged");
      } finally {
        yield* Effect.promise(() => orchestrator.dispose());
      }
    }),
  );

it(
  "waits for an external command to exit 0 before starting a task",
  waitsForAnExternalCommandToExit,
);

const closesEachRoundSReviewWithoutWaiting = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator, workers } = setup();
      yield* create(orchestrator, {
        currentState: "a is not written",
        goalState: "a works",
        round: "one",
        title: "a",
      });
      const b = yield* create(orchestrator, {
        currentState: "b is not written",
        goalState: "b works",
        round: "two",
        title: "b",
      });
      workers.find((worker) => worker.prompts[0]?.includes("a works"))?.complete("a done");
      yield* waitFor(() =>
        workers.some(
          (worker) =>
            worker.prompts[0]?.includes("reviewing work another thread") === true &&
            worker.prompts[0]?.includes("a done") === true,
        ),
      );
      workers
        .find(
          (worker) =>
            worker.prompts[0]?.includes("reviewing work another thread") === true &&
            worker.prompts[0]?.includes("a done") === true,
        )
        ?.complete("a reviewed");
      yield* waitFor(() =>
        reviews(orchestrator).some((task) => task.round === "one" && task.status === "running"),
      );
      expect(taskStatus(orchestrator, b.id)).toBe("running");
    }),
  );

it(
  "closes each round's review without waiting for another round's tasks",
  closesEachRoundSReviewWithoutWaiting,
);

const changesARunningTaskSModel = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator, workers } = setup();
      const a = yield* create(orchestrator, {
        currentState: "a is not written",
        goalState: "a works",
        title: "a",
      });
      yield* Effect.promise(() => orchestrator.setModel(a.id, "sub/fable", "high"));
      expect(workers[0]?.model.id).toBe("fable");
      expect(workers[0]?.thinkingLevel).toBe("high");
    }),
  );

it("changes a running task's model", changesARunningTaskSModel);

const stopsATaskAndLeavesItsDependents = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator } = setup();
      const a = yield* create(orchestrator, {
        currentState: "a is not written",
        goalState: "a works",
        title: "a",
      });
      const b = yield* create(orchestrator, {
        currentState: "b is not written",
        dependsOn: [a.id],
        goalState: "b works",
        title: "b",
      });
      const stopped = yield* Effect.promise(() => orchestrator.stop(a.id));
      expect(stopped.status).toBe("stopped");
      expect(taskStatus(orchestrator, b.id)).toBe("waiting");
    }),
  );

it("stops a task and leaves its dependents waiting", stopsATaskAndLeavesItsDependents);
