import testing from "@msa/testing";
import { Effect } from "effect";
import { expect, it } from "vite-plus/test";

import orchestratorHarness from "./orchestrator-harness.ts";
import orchestratorSupport from "./orchestrator-support.ts";

const { joinPath, makeTempDir, removePath } = testing;

const { harness } = orchestratorHarness;
const { completing } = harness;

const { setup, taskStatus, waitFor } = harness;

const { create, createNamed, failureMessageOf, finishWorkAndReview, read } = orchestratorSupport;

const addsADependencyToAWaitingTask = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator, workers } = setup({ maxConcurrent: 2 });
      const a = yield* createNamed(orchestrator, "a");
      const b = yield* createNamed(orchestrator, "b", { dependsOn: [a.id] });
      const c = yield* createNamed(orchestrator, "c");
      expect(workers).toHaveLength(2);

      yield* Effect.promise(() => orchestrator.setDepends({ add: [c.id], taskIds: [b.id] }));
      const view = yield* read(orchestrator, b.id);
      expect(view.dependsOn.toSorted()).toEqual([a.id, c.id].toSorted());
      expect(view.status).toBe("waiting");

      yield* finishWorkAndReview(workers, 1, "c done", "c reviewed");
      yield* waitFor(() => taskStatus(orchestrator, c.id) === "completed");
      expect(taskStatus(orchestrator, b.id)).toBe("waiting");

      yield* completing(workers[0], "a done", () => workers.length === 4);
      yield* completing(workers[3], "a reviewed", () => workers.length === 5);
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
      const a = yield* createNamed(orchestrator, "a");
      const b = yield* createNamed(orchestrator, "b", { dependsOn: [a.id] });
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
      yield* createNamed(orchestrator, "a");
      const b = yield* createNamed(orchestrator, "b");
      const c = yield* createNamed(orchestrator, "c");
      yield* Effect.promise(() => orchestrator.setDepends({ add: [c.id], taskIds: [b.id] }));

      expect(
        yield* failureMessageOf(() => orchestrator.setDepends({ add: [b.id], taskIds: [c.id] })),
      ).toContain("cycle");
      expect(
        yield* failureMessageOf(() => orchestrator.setDepends({ add: [c.id], taskIds: [c.id] })),
      ).toContain("itself");

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
      const a = yield* createNamed(orchestrator, "a");
      const c = yield* createNamed(orchestrator, "c");

      expect(
        yield* failureMessageOf(() => orchestrator.setDepends({ add: [c.id], taskIds: [a.id] })),
      ).toContain("stop_task");
      expect(
        yield* failureMessageOf(() => orchestrator.setDepends({ remove: [c.id], taskIds: [a.id] })),
      ).toContain("stop_task");

      yield* finishWorkAndReview(workers, 1, "c done", "c reviewed");
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
      const a = yield* createNamed(orchestrator, "a");
      const b = yield* create(orchestrator, {
        currentState: "the client speaks v2",
        dependsOn: [a.id],
        goalState: "the client speaks v3",
        title: "b",
      });

      expect(
        yield* failureMessageOf(() =>
          orchestrator.setState({ goalState: "a works twice", taskId: a.id }),
        ),
      ).toContain("running");
      yield* failureMessageOf(() => orchestrator.setState({ taskId: b.id }));
      yield* failureMessageOf(() => orchestrator.setState({ goalState: " ", taskId: b.id }));

      yield* Effect.promise(() =>
        orchestrator.setState({ goalState: "the client speaks v4", taskId: b.id }),
      );
      const view = yield* read(orchestrator, b.id);
      expect(view.currentState).toBe("the client speaks v2");
      expect(view.goalState).toBe("the client speaks v4");

      yield* finishWorkAndReview(workers, 0, "a done", "a reviewed");
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
        const a = yield* createNamed(first.orchestrator, "a");
        const b = yield* createNamed(first.orchestrator, "b", { dependsOn: [a.id] });
        const c = yield* createNamed(first.orchestrator, "c");
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
