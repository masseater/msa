import { Effect } from "effect";
import { expect, it } from "vite-plus/test";

import type { Orchestrator } from "../src/core/orchestrator/orchestrator.ts";
import { store } from "../src/core/orchestrator/store.ts";
import { harness } from "./orchestrator-harness.ts";

const { setup, taskStatus, waitFor } = harness;

const create = (orchestrator: Orchestrator, input: Parameters<Orchestrator["createTask"]>[0]) =>
  Effect.promise(() => orchestrator.createTask(input));

const read = (orchestrator: Orchestrator, id: string) =>
  Effect.promise(() => orchestrator.read(id));

it("runs a worker, then a separate reviewer session with the review model", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator, workers } = setup();
      const task = yield* create(orchestrator, { title: "a", prompt: "do a" });
      expect(task.status).toBe("running");
      expect(workers).toHaveLength(1);
      expect(workers[0]?.model.id).toBe("flash");
      expect(workers[0]?.thinkingLevel).toBe("low");

      workers[0]?.complete("did a");
      yield* waitFor(() => workers.length === 2);
      expect(workers[1]?.model.id).toBe("fable");
      expect(workers[1]?.thinkingLevel).toBe("high");
      expect(workers[1]?.prompts[0]).toContain("did a");
      expect(workers[1]?.prompts[0]).toContain("reviewing work another session");

      workers[1]?.complete("looks good");
      yield* waitFor(() => taskStatus(orchestrator, task.id) === "completed");
      const view = yield* read(orchestrator, task.id);
      expect(view.reports.map((report) => report.role)).toEqual(["worker", "reviewer"]);
      expect(view.assignments.map((assignment) => assignment.role)).toEqual(["worker", "reviewer"]);
      expect(view.assignments[0]?.sessionId).not.toBe(view.assignments[1]?.sessionId);
    }),
  ));

it("waits for dependencies and passes the reports on", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator, workers } = setup();
      const a = yield* create(orchestrator, { title: "a", prompt: "do a" });
      const b = yield* create(orchestrator, {
        title: "b",
        prompt: "do b",
        dependsOn: [a.id],
      });
      expect(b.status).toBe("waiting");
      expect(workers).toHaveLength(1);

      workers[0]?.complete("api is at /v2");
      yield* waitFor(() => workers.length === 2);
      workers[1]?.complete("reviewed a");
      yield* waitFor(() => workers.length === 3);
      expect(workers[2]?.prompts[0]).toContain("do b");
      expect(workers[2]?.prompts[0]).toContain("reviewed a");
    }),
  ));

it("keeps a message to a waiting task and adds it to the prompt at start", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator, workers } = setup();
      const a = yield* create(orchestrator, { title: "a", prompt: "do a" });
      const b = yield* create(orchestrator, {
        title: "b",
        prompt: "do b",
        dependsOn: [a.id],
      });
      const queued = yield* Effect.promise(() =>
        orchestrator.sendMessage(b.id, "also update the docs"),
      );
      expect(queued.status).toBe("waiting");

      workers[0]?.complete("a done");
      yield* waitFor(() => workers.length === 2);
      workers[1]?.complete("a reviewed");
      yield* waitFor(() => workers.length === 3);
      expect(workers[2]?.prompts[0]).toContain("also update the docs");
    }),
  ));

it("steers running sessions with a shared note and delivers it to waiting tasks", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator, workers } = setup();
      const a = yield* create(orchestrator, { title: "a", prompt: "do a" });
      const b = yield* create(orchestrator, {
        title: "b",
        prompt: "do b",
        dependsOn: [a.id],
      });
      const delivery = yield* Effect.promise(() =>
        orchestrator.sendNote({ content: "never touch x.ts", audience: "all" }),
      );
      expect(delivery.steeredSessions).toHaveLength(1);
      expect(workers[0]?.steered).toEqual(["never touch x.ts"]);

      workers[0]?.complete("a done");
      yield* waitFor(() => workers.length === 2);
      workers[1]?.complete("a reviewed");
      yield* waitFor(() => workers.length === 3);
      expect(workers[2]?.prompts[0]).toContain("never touch x.ts");
      expect(taskStatus(orchestrator, b.id)).toBe("running");
    }),
  ));

it("re-reads a note at the turn boundary and continues the same session", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator, workers } = setup();
      const a = yield* create(orchestrator, { title: "a", prompt: "do a" });
      workers[0]?.complete("first pass");
      store.insertNote(orchestrator.database, {
        id: "note-boundary",
        project: "project",
        round: null,
        taskIds: [a.id],
        content: "continue with the cache fix",
        author: "test",
        createdAt: 1,
      });
      yield* waitFor(() => (workers[0]?.prompts.length ?? 0) === 2);
      expect(workers).toHaveLength(1);
      expect(workers[0]?.prompts[1]).toContain("continue with the cache fix");
    }),
  ));

it("searches reports across tasks and sessions", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator, workers } = setup();
      const task = yield* create(orchestrator, { title: "a", prompt: "do a" });
      workers[0]?.complete("alpha implementation");
      yield* waitFor(() => workers.length === 2);
      workers[1]?.complete("alpha reviewed");
      yield* waitFor(() => taskStatus(orchestrator, task.id) === "completed");

      const hits = yield* Effect.promise(() => orchestrator.searchReports("alpha"));
      expect(hits.map((hit) => hit.report.role).toSorted()).toEqual(["reviewer", "worker"]);
      const reviewed = yield* Effect.promise(() => orchestrator.searchReports("reviewed"));
      expect(reviewed).toHaveLength(1);
      expect(reviewed[0]?.report.content).toContain("alpha reviewed");
    }),
  ));
