import { Effect, Result } from "effect";
import { expect, it } from "vite-plus/test";

import { orchestratorError } from "../src/core/orchestrator/errors.ts";
import type { Orchestrator } from "../src/core/orchestrator/orchestrator.ts";
import { harness } from "./orchestrator-harness.ts";

const { reviews, setup, taskStatus, waitFor } = harness;

const create = (orchestrator: Orchestrator, input: Parameters<Orchestrator["createTask"]>[0]) =>
  Effect.promise(() => orchestrator.createTask(input));

it("waits again for a dependency added after the task is stopped", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator, workers } = setup();
      const a = yield* create(orchestrator, {
        title: "a",
        currentState: "a is not written",
        goalState: "a works",
      });
      const c = yield* create(orchestrator, {
        title: "c",
        currentState: "c is not written",
        goalState: "c works",
      });
      const rejected = yield* Effect.result(
        Effect.tryPromise({
          try: () => orchestrator.setDepends({ taskIds: [a.id], add: [c.id] }),
          catch: orchestratorError,
        }),
      );
      expect(Result.isFailure(rejected)).toBe(true);
      expect(taskStatus(orchestrator, a.id)).toBe("running");

      yield* Effect.promise(() => orchestrator.stop(a.id));
      yield* Effect.promise(() => orchestrator.setDepends({ taskIds: [a.id], add: [c.id] }));
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
  ));

it("starts ready tasks in creation order within the concurrency limit", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator, workers } = setup({ maxConcurrent: 1 });
      const a = yield* create(orchestrator, {
        title: "a",
        currentState: "a is not written",
        goalState: "a works",
      });
      const b = yield* create(orchestrator, {
        title: "b",
        currentState: "b is not written",
        goalState: "b works",
      });
      const c = yield* create(orchestrator, {
        title: "c",
        currentState: "c is not written",
        goalState: "c works",
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
  ));

it("changes the concurrency limit while tasks wait", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator, workers } = setup({ maxConcurrent: 1 });
      yield* create(orchestrator, {
        title: "a",
        currentState: "a is not written",
        goalState: "a works",
      });
      yield* create(orchestrator, {
        title: "b",
        currentState: "b is not written",
        goalState: "b works",
      });
      yield* create(orchestrator, {
        title: "c",
        currentState: "c is not written",
        goalState: "c works",
      });
      expect(workers).toHaveLength(1);

      yield* Effect.promise(() => orchestrator.setMaxConcurrentThreads(3));
      yield* waitFor(() => workers.length === 3);
      expect(orchestrator.snapshot.maxConcurrentThreads).toBe(3);
    }),
  ));

it("waits for an external command to exit 0 before starting a task", () =>
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
          title: "merge",
          currentState: "the branch is not merged",
          goalState: "the branch is merged and main is green",
          cwd: "/tmp",
          condition: "check-external-state",
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
  ));

it("closes each round's review without waiting for another round's tasks", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator, workers } = setup();
      yield* create(orchestrator, {
        title: "a",
        currentState: "a is not written",
        goalState: "a works",
        round: "one",
      });
      const b = yield* create(orchestrator, {
        title: "b",
        currentState: "b is not written",
        goalState: "b works",
        round: "two",
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
  ));

it("changes a running task's model", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator, workers } = setup();
      const a = yield* create(orchestrator, {
        title: "a",
        currentState: "a is not written",
        goalState: "a works",
      });
      yield* Effect.promise(() => orchestrator.setModel(a.id, "sub/fable", "high"));
      expect(workers[0]?.model.id).toBe("fable");
      expect(workers[0]?.thinkingLevel).toBe("high");
    }),
  ));

it("stops a task and leaves its dependents waiting", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator } = setup();
      const a = yield* create(orchestrator, {
        title: "a",
        currentState: "a is not written",
        goalState: "a works",
      });
      const b = yield* create(orchestrator, {
        title: "b",
        currentState: "b is not written",
        goalState: "b works",
        dependsOn: [a.id],
      });
      const stopped = yield* Effect.promise(() => orchestrator.stop(a.id));
      expect(stopped.status).toBe("stopped");
      expect(taskStatus(orchestrator, b.id)).toBe("waiting");
    }),
  ));
