import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Effect, Result } from "effect";
import { expect, it } from "vite-plus/test";

import { orchestratorError } from "../src/core/orchestrator/errors.ts";
import type { Orchestrator } from "../src/core/orchestrator/orchestrator.ts";
import { harness } from "./orchestrator-harness.ts";

const { setup, taskStatus, waitFor } = harness;

const create = (orchestrator: Orchestrator, input: Parameters<Orchestrator["createTask"]>[0]) =>
  Effect.promise(() => orchestrator.createTask(input));

const read = (orchestrator: Orchestrator, id: string) =>
  Effect.promise(() => orchestrator.read(id));

function attempt<A>(run: () => Promise<A>) {
  return Effect.result(Effect.tryPromise({ try: run, catch: orchestratorError }));
}

it("adds a dependency to a waiting task and starts it once both dependencies finish", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator, workers } = setup({ maxConcurrent: 2 });
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
      const c = yield* create(orchestrator, {
        title: "c",
        currentState: "c is not written",
        goalState: "c works",
      });
      expect(workers).toHaveLength(2);

      yield* Effect.promise(() => orchestrator.setDepends({ taskIds: [b.id], add: [c.id] }));
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
  ));

it("drops a dependency and starts the task that was waiting for it", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator, workers } = setup();
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
      expect(taskStatus(orchestrator, b.id)).toBe("waiting");

      yield* Effect.promise(() => orchestrator.setDepends({ taskIds: [b.id], remove: [a.id] }));
      yield* waitFor(() => workers.length === 2);
      const view = yield* read(orchestrator, b.id);
      expect(view.dependsOn).toEqual([]);
      expect(view.status).toBe("running");
      expect(workers[1]?.prompts[0]).toContain("b works");
    }),
  ));

it("rejects a cycle and a task that depends on itself without changing anything", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator } = setup({ maxConcurrent: 1 });
      yield* create(orchestrator, {
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
      yield* Effect.promise(() => orchestrator.setDepends({ taskIds: [b.id], add: [c.id] }));

      const cycle = yield* attempt(() => orchestrator.setDepends({ taskIds: [c.id], add: [b.id] }));
      expect(Result.isFailure(cycle)).toBe(true);
      if (Result.isFailure(cycle)) expect(cycle.failure.message).toContain("cycle");

      const itself = yield* attempt(() =>
        orchestrator.setDepends({ taskIds: [c.id], add: [c.id] }),
      );
      expect(Result.isFailure(itself)).toBe(true);
      if (Result.isFailure(itself)) expect(itself.failure.message).toContain("itself");

      const view = yield* read(orchestrator, c.id);
      expect(view.dependsOn).toEqual([]);
      expect((yield* read(orchestrator, b.id)).dependsOn).toEqual([c.id]);
    }),
  ));

it("rejects dependency changes on a running task except adding one that already finished", () =>
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

      const added = yield* attempt(() => orchestrator.setDepends({ taskIds: [a.id], add: [c.id] }));
      expect(Result.isFailure(added)).toBe(true);
      if (Result.isFailure(added)) expect(added.failure.message).toContain("stop_task");

      const removed = yield* attempt(() =>
        orchestrator.setDepends({ taskIds: [a.id], remove: [c.id] }),
      );
      expect(Result.isFailure(removed)).toBe(true);
      if (Result.isFailure(removed)) expect(removed.failure.message).toContain("stop_task");

      workers[1]?.complete("c done");
      yield* waitFor(() => workers.length === 3);
      workers[2]?.complete("c reviewed");
      yield* waitFor(() => taskStatus(orchestrator, c.id) === "completed");

      yield* Effect.promise(() => orchestrator.setDepends({ taskIds: [a.id], add: [c.id] }));
      const view = yield* read(orchestrator, a.id);
      expect(view.dependsOn).toEqual([c.id]);
      expect(view.status).toBe("running");
    }),
  ));

it("rewrites the states of a waiting task and the session starts with them", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator, workers } = setup();
      const a = yield* create(orchestrator, {
        title: "a",
        currentState: "a is not written",
        goalState: "a works",
      });
      const b = yield* create(orchestrator, {
        title: "b",
        currentState: "the client speaks v2",
        goalState: "the client speaks v3",
        dependsOn: [a.id],
      });

      const running = yield* attempt(() =>
        orchestrator.setState({ taskId: a.id, goalState: "a works twice" }),
      );
      expect(Result.isFailure(running)).toBe(true);
      if (Result.isFailure(running)) expect(running.failure.message).toContain("running");

      const nothing = yield* attempt(() => orchestrator.setState({ taskId: b.id }));
      expect(Result.isFailure(nothing)).toBe(true);
      const blank = yield* attempt(() => orchestrator.setState({ taskId: b.id, goalState: " " }));
      expect(Result.isFailure(blank)).toBe(true);

      yield* Effect.promise(() =>
        orchestrator.setState({ taskId: b.id, goalState: "the client speaks v4" }),
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
  ));

it("keeps the rewritten dependencies and states after the database is reopened", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = mkdtempSync(join(tmpdir(), "msa-orchestrator-"));
      const databasePath = join(directory, "orchestrator.db");
      try {
        const first = setup({ databasePath });
        const a = yield* create(first.orchestrator, {
          title: "a",
          currentState: "a is not written",
          goalState: "a works",
        });
        const b = yield* create(first.orchestrator, {
          title: "b",
          currentState: "b is not written",
          goalState: "b works",
          dependsOn: [a.id],
        });
        const c = yield* create(first.orchestrator, {
          title: "c",
          currentState: "c is not written",
          goalState: "c works",
        });
        yield* Effect.promise(() =>
          first.orchestrator.setDepends({ taskIds: [b.id], add: [c.id] }),
        );
        yield* Effect.promise(() =>
          first.orchestrator.setState({
            taskId: b.id,
            currentState: "b calls the old api",
            goalState: "b calls the new api",
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
        rmSync(directory, { recursive: true, force: true });
      }
    }),
  ));
