import { Effect } from "effect";
import { expect, it } from "vite-plus/test";

import type orchestratorTypes from "../src/core/orchestrator/orchestrator.types.ts";
import orchestratorHarness from "./orchestrator-harness.ts";

const { harness } = orchestratorHarness;

const { setup, taskStatus, waitFor } = harness;

type CreateInput = Parameters<orchestratorTypes.Orchestrator["createTask"]>[0];

const create = (orchestrator: orchestratorTypes.Orchestrator, input: CreateInput) =>
  Effect.promise(() => orchestrator.createTask(input));

const attempt = (orchestrator: orchestratorTypes.Orchestrator, input: CreateInput) =>
  Effect.promise(() =>
    orchestrator.createTask(input).then(
      () => undefined,
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    ),
  );

const work = (title: string, dependsOn?: string[]): CreateInput => ({
  currentState: `${title} is not written`,
  goalState: `${title} works`,
  title,
  ...(dependsOn === undefined ? {} : { dependsOn }),
});

it("accepts a task without dependencies while two tasks are unfinished", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator } = setup({ maxConcurrent: 1 });
      yield* create(orchestrator, work("a"));
      yield* create(orchestrator, work("b"));
      const third = yield* create(orchestrator, work("c", []));
      expect(third.dependsOn).toEqual([]);
      expect((yield* Effect.promise(() => orchestrator.list())).length).toBeGreaterThanOrEqual(3);
    }),
  ));

it("rejects a task without dependencies once three tasks are unfinished and points to replan", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator } = setup({ maxConcurrent: 1 });
      const a = yield* create(orchestrator, work("a"));
      const b = yield* create(orchestrator, work("b"));
      const c = yield* create(orchestrator, work("c"));
      const before = yield* Effect.promise(() => orchestrator.list());

      const omitted = yield* attempt(orchestrator, work("d"));
      const empty = yield* attempt(orchestrator, work("e", []));

      for (const message of [omitted, empty]) {
        expect(message).toContain("dependsOn");
        expect(message).toContain("replan");
        expect(message).toContain(a.id);
        expect(message).toContain(b.id);
        expect(message).toContain(c.id);
      }
      expect(yield* Effect.promise(() => orchestrator.list())).toHaveLength(before.length);
    }),
  ));

it("accepts a task that names a dependency while three tasks are unfinished", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator } = setup({ maxConcurrent: 1 });
      const a = yield* create(orchestrator, work("a"));
      yield* create(orchestrator, work("b"));
      yield* create(orchestrator, work("c"));
      const d = yield* create(orchestrator, work("d", [a.id]));
      expect(d.dependsOn).toEqual([a.id]);
      expect(d.status).toBe("waiting");
    }),
  ));

it("counts only unfinished tasks, so a finished one frees a slot", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator, workers } = setup({ maxConcurrent: 1 });
      const a = yield* create(orchestrator, work("a"));
      yield* create(orchestrator, work("b"));
      yield* create(orchestrator, work("c"));
      workers[0]?.complete("a done");
      yield* waitFor(() => workers.length === 2);
      workers[1]?.complete("a reviewed");
      yield* waitFor(() => taskStatus(orchestrator, a.id) === "completed");

      const d = yield* create(orchestrator, work("d"));
      expect(d.dependsOn).toEqual([]);
    }),
  ));
