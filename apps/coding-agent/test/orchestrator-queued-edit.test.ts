import testing from "@msa/testing";
import { Effect, Result } from "effect";
import { expect, it } from "vite-plus/test";

import { orchestratorError } from "../src/core/orchestrator/errors.ts";
import type { Orchestrator } from "../src/core/orchestrator/orchestrator.ts";
import orchestratorHarness from "./orchestrator-harness.ts";

const { joinPath, makeTempDir, removePath } = testing;

const { harness } = orchestratorHarness;

const { setup, taskStatus, waitFor } = harness;

const create = (orchestrator: Orchestrator, input: Parameters<Orchestrator["createTask"]>[0]) =>
  Effect.promise(() => orchestrator.createTask(input));

const read = (orchestrator: Orchestrator, id: string) =>
  Effect.promise(() => orchestrator.read(id));

function attempt<A>(run: () => Promise<A>) {
  return Effect.result(Effect.tryPromise({ catch: orchestratorError, try: run }));
}

const addsADependencyToAWaitingTask = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator, workers } = setup({ maxConcurrent: 2 });
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
      const c = yield* create(orchestrator, {
        currentState: "c is not written",
        goalState: "c works",
        title: "c",
      });
      expect(workers).toHaveLength(2);

      yield* Effect.promise(() => orchestrator.setDepends({ add: [c.id], taskIds: [b.id] }));
      const view = yield* read(orchestrator, b.id);
      expect(view.dependsOn.toSorted()).toEqual([a.id, c.id].toSorted());
      expect(view.status).toBe("waiting");

      workers[1]?.complete("c done");
      yield* waitFor(() => workers.length === 3);
      workers[2]?.complete("c reviewed");
      yield* waitFor(() => taskStatus(orchestrator, c.id) === "completed");
      expect(taskStatus(orchestrator, b.id)).toBe("waiting");

      workers[0]?.complete("a done");
      yield* waitFor(() => workers.length === 4);
      workers[3]?.complete("a reviewed");
      yield* waitFor(() => workers.length === 5);
      expect(taskStatus(orchestrator, b.id)).toBe("running");
      expect(workers[4]?.prompts[0]).toContain("b works");
      expect(workers[4]?.prompts[0]).toContain("a reviewed");
      expect(workers[4]?.prompts[0]).toContain("c reviewed");
    }),
  );

it(
  "adds a dependency to a waiting task and starts it once both dependencies finish",
  addsADependencyToAWaitingTask,
);

const dropsADependencyAndStartsTheTask = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator, workers } = setup();
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
      expect(taskStatus(orchestrator, b.id)).toBe("waiting");

      yield* Effect.promise(() => orchestrator.setDepends({ remove: [a.id], taskIds: [b.id] }));
      yield* waitFor(() => workers.length === 2);
      const view = yield* read(orchestrator, b.id);
      expect(view.dependsOn).toEqual([]);
      expect(view.status).toBe("running");
      expect(workers[1]?.prompts[0]).toContain("b works");
    }),
  );

it(
  "drops a dependency and starts the task that was waiting for it",
  dropsADependencyAndStartsTheTask,
);

const rejectsACycleAndATaskThat = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator } = setup({ maxConcurrent: 1 });
      yield* create(orchestrator, {
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
      yield* Effect.promise(() => orchestrator.setDepends({ add: [c.id], taskIds: [b.id] }));

      const cycle = yield* attempt(() => orchestrator.setDepends({ add: [b.id], taskIds: [c.id] }));
      expect(Result.isFailure(cycle)).toBe(true);
      if (Result.isFailure(cycle)) expect(cycle.failure.message).toContain("cycle");

      const itself = yield* attempt(() =>
        orchestrator.setDepends({ add: [c.id], taskIds: [c.id] }),
      );
      expect(Result.isFailure(itself)).toBe(true);
      if (Result.isFailure(itself)) expect(itself.failure.message).toContain("itself");

      const view = yield* read(orchestrator, c.id);
      expect(view.dependsOn).toEqual([]);
      expect((yield* read(orchestrator, b.id)).dependsOn).toEqual([c.id]);
    }),
  );

it(
  "rejects a cycle and a task that depends on itself without changing anything",
  rejectsACycleAndATaskThat,
);

const rejectsDependencyChangesOnARunningTask = () =>
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

      const added = yield* attempt(() => orchestrator.setDepends({ add: [c.id], taskIds: [a.id] }));
      expect(Result.isFailure(added)).toBe(true);
      if (Result.isFailure(added)) expect(added.failure.message).toContain("stop_task");

      const removed = yield* attempt(() =>
        orchestrator.setDepends({ remove: [c.id], taskIds: [a.id] }),
      );
      expect(Result.isFailure(removed)).toBe(true);
      if (Result.isFailure(removed)) expect(removed.failure.message).toContain("stop_task");

      workers[1]?.complete("c done");
      yield* waitFor(() => workers.length === 3);
      workers[2]?.complete("c reviewed");
      yield* waitFor(() => taskStatus(orchestrator, c.id) === "completed");

      yield* Effect.promise(() => orchestrator.setDepends({ add: [c.id], taskIds: [a.id] }));
      const view = yield* read(orchestrator, a.id);
      expect(view.dependsOn).toEqual([c.id]);
      expect(view.status).toBe("running");
    }),
  );

it(
  "rejects dependency changes on a running task except adding one that already finished",
  rejectsDependencyChangesOnARunningTask,
);

const rewritesTheStatesOfAWaitingTask = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator, workers } = setup();
      const a = yield* create(orchestrator, {
        currentState: "a is not written",
        goalState: "a works",
        title: "a",
      });
      const b = yield* create(orchestrator, {
        currentState: "the client speaks v2",
        dependsOn: [a.id],
        goalState: "the client speaks v3",
        title: "b",
      });

      const running = yield* attempt(() =>
        orchestrator.setState({ goalState: "a works twice", taskId: a.id }),
      );
      expect(Result.isFailure(running)).toBe(true);
      if (Result.isFailure(running)) expect(running.failure.message).toContain("running");

      const nothing = yield* attempt(() => orchestrator.setState({ taskId: b.id }));
      expect(Result.isFailure(nothing)).toBe(true);
      const blank = yield* attempt(() => orchestrator.setState({ goalState: " ", taskId: b.id }));
      expect(Result.isFailure(blank)).toBe(true);

      yield* Effect.promise(() =>
        orchestrator.setState({ goalState: "the client speaks v4", taskId: b.id }),
      );
      const view = yield* read(orchestrator, b.id);
      expect(view.currentState).toBe("the client speaks v2");
      expect(view.goalState).toBe("the client speaks v4");

      workers[0]?.complete("a done");
      yield* waitFor(() => workers.length === 2);
      workers[1]?.complete("a reviewed");
      yield* waitFor(() => workers.length === 3);
      expect(workers[2]?.prompts[0]).toContain("the client speaks v2");
      expect(workers[2]?.prompts[0]).toContain("the client speaks v4");
      expect(workers[2]?.prompts[0]).not.toContain("the client speaks v3");
    }),
  );

it(
  "rewrites the states of a waiting task and the thread starts with them",
  rewritesTheStatesOfAWaitingTask,
);

const keepsTheRewrittenDependenciesAndStatesAfter = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* makeTempDir("msa-orchestrator-");
      const databasePath = joinPath(directory, "orchestrator.db");
      try {
        const first = setup({ databasePath });
        const a = yield* create(first.orchestrator, {
          currentState: "a is not written",
          goalState: "a works",
          title: "a",
        });
        const b = yield* create(first.orchestrator, {
          currentState: "b is not written",
          dependsOn: [a.id],
          goalState: "b works",
          title: "b",
        });
        const c = yield* create(first.orchestrator, {
          currentState: "c is not written",
          goalState: "c works",
          title: "c",
        });
        yield* Effect.promise(() =>
          first.orchestrator.setDepends({ add: [c.id], taskIds: [b.id] }),
        );
        yield* Effect.promise(() =>
          first.orchestrator.setState({
            currentState: "b calls the old api",
            goalState: "b calls the new api",
            taskId: b.id,
          }),
        );
        yield* Effect.promise(() => first.orchestrator.dispose());

        const second = setup({ databasePath });
        try {
          const view = yield* read(second.orchestrator, b.id);
          expect(view.currentState).toBe("b calls the old api");
          expect(view.goalState).toBe("b calls the new api");
          expect(view.dependsOn.toSorted()).toEqual([a.id, c.id].toSorted());
        } finally {
          yield* Effect.promise(() => second.orchestrator.dispose());
        }
      } finally {
        yield* removePath(directory);
      }
    }),
  );

it(
  "keeps the rewritten dependencies and states after the database is reopened",
  keepsTheRewrittenDependenciesAndStatesAfter,
);
