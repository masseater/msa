import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";

import { Effect, Result } from "effect";
import { expect, it } from "vite-plus/test";

import { orchestratorError } from "../src/core/orchestrator/errors.ts";
import type { Orchestrator } from "../src/core/orchestrator/orchestrator.ts";
import { store } from "../src/core/orchestrator/store.ts";
import { harness } from "./orchestrator-harness.ts";

const { setup, taskStatus, waitFor } = harness;

const create = (orchestrator: Orchestrator, input: Parameters<Orchestrator["createTask"]>[0]) =>
  Effect.promise(() => orchestrator.createTask(input));

const read = (orchestrator: Orchestrator, id: string) =>
  Effect.promise(() => orchestrator.read(id));

it("builds the worker prompt from the two states and nothing else", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator, workers } = setup();
      yield* create(orchestrator, {
        title: "cache reads",
        currentState: "src/cache.ts has no cache and repeated reads go to the network",
        goalState: "repeated reads hit the cache and a test covers the second read",
      });
      expect(workers[0]?.prompts[0]).toBe(
        [
          "<current-state>\nsrc/cache.ts has no cache and repeated reads go to the network\n</current-state>",
          "<goal-state>\nrepeated reads hit the cache and a test covers the second read\n</goal-state>",
        ].join("\n\n"),
      );
    }),
  ));

it("opens a database from before the task states and keeps its tasks", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = mkdtempSync(`${tmpdir()}/msa-orchestrator-legacy-`);
      const path = `${directory}/orchestrator.db`;
      const legacy = new DatabaseSync(path);
      legacy.exec(`CREATE TABLE tasks (
        id TEXT PRIMARY KEY, project TEXT NOT NULL, round TEXT NOT NULL, kind TEXT NOT NULL,
        title TEXT NOT NULL, prompt TEXT NOT NULL, status TEXT NOT NULL,
        priority INTEGER NOT NULL DEFAULT 0, cwd TEXT NOT NULL,
        paths TEXT NOT NULL DEFAULT '[]', repos TEXT NOT NULL DEFAULT '[]',
        condition TEXT, model TEXT, thinking_level TEXT,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`);
      legacy
        .prepare("INSERT INTO tasks VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(
          "t-old",
          "project",
          "main",
          "work",
          "old work",
          "the old work is half done",
          "stopped",
          5,
          "/repo",
          '["src/a.ts"]',
          '["repo"]',
          null,
          null,
          null,
          1,
          1,
        );
      legacy.close();
      const { orchestrator } = setup({ databasePath: path });
      try {
        const task = yield* read(orchestrator, "t-old");
        expect(task.currentState).toBe("the old work is half done");
        expect(task.goalState).toBe("old work");
        const columns = orchestrator.database
          .prepare("PRAGMA table_info(tasks)")
          .all()
          .map((column) => (column as { name: string }).name);
        expect(columns).not.toContain("prompt");
        expect(columns).not.toContain("priority");
        expect(columns).not.toContain("paths");
        expect(columns).not.toContain("repos");
        yield* create(orchestrator, {
          title: "new work",
          currentState: "the new work is not started",
          goalState: "the new work is done",
        });
        const created = orchestrator.snapshot.tasks.find(
          (candidate) => candidate.title === "new work",
        );
        expect(created?.currentState).toBe("the new work is not started");
      } finally {
        yield* Effect.promise(() => orchestrator.dispose());
        rmSync(directory, { recursive: true, force: true });
      }
    }),
  ));

it("rejects a task without a current state or a goal state", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator, workers } = setup();
      type CreateInput = Parameters<Orchestrator["createTask"]>[0];
      const reject = (input: CreateInput) =>
        Effect.result(
          Effect.tryPromise({
            try: () => orchestrator.createTask(input),
            catch: orchestratorError,
          }),
        );
      const withoutGoal = yield* reject({
        title: "a",
        currentState: "a is not written",
      } as CreateInput);
      expect(Result.isFailure(withoutGoal)).toBe(true);
      if (Result.isFailure(withoutGoal)) {
        expect(withoutGoal.failure.message).toContain("goal state");
      }
      const blankCurrent = yield* reject({
        title: "b",
        currentState: "  ",
        goalState: "b works",
      } as CreateInput);
      expect(Result.isFailure(blankCurrent)).toBe(true);
      if (Result.isFailure(blankCurrent)) {
        expect(blankCurrent.failure.message).toContain("current state");
      }
      expect(orchestrator.snapshot.tasks).toEqual([]);
      expect(workers).toHaveLength(0);
    }),
  ));

it("runs a worker, then a separate reviewer thread with the review model", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator, workers } = setup();
      const task = yield* create(orchestrator, {
        title: "a",
        currentState: "a is not written",
        goalState: "a works",
      });
      expect(task.status).toBe("running");
      expect(workers).toHaveLength(1);
      expect(workers[0]?.model.id).toBe("flash");
      expect(workers[0]?.thinkingLevel).toBe("low");

      workers[0]?.complete("did a");
      yield* waitFor(() => workers.length === 2);
      expect(workers[1]?.model.id).toBe("fable");
      expect(workers[1]?.thinkingLevel).toBe("high");
      expect(workers[1]?.prompts[0]).toContain("did a");
      expect(workers[1]?.prompts[0]).toContain("reviewing work another thread");

      workers[1]?.complete("looks good");
      yield* waitFor(() => taskStatus(orchestrator, task.id) === "completed");
      const view = yield* read(orchestrator, task.id);
      expect(view.reports.map((report) => report.role)).toEqual(["worker", "reviewer"]);
      expect(view.assignments.map((assignment) => assignment.role)).toEqual(["worker", "reviewer"]);
      expect(view.assignments[0]?.threadId).not.toBe(view.assignments[1]?.threadId);
    }),
  ));

it("waits for dependencies and passes the reports on", () =>
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
      expect(b.status).toBe("waiting");
      expect(workers).toHaveLength(1);

      workers[0]?.complete("api is at /v2");
      yield* waitFor(() => workers.length === 2);
      workers[1]?.complete("reviewed a");
      yield* waitFor(() => workers.length === 3);
      expect(workers[2]?.prompts[0]).toContain("b is not written");
      expect(workers[2]?.prompts[0]).toContain("b works");
      expect(workers[2]?.prompts[0]).toContain("reviewed a");
    }),
  ));

it("keeps a message to a waiting task and adds it to the prompt at start", () =>
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

it("steers running threads with a shared note and delivers it to waiting tasks", () =>
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
      const delivery = yield* Effect.promise(() =>
        orchestrator.sendNote({ content: "never touch x.ts", audience: "all" }),
      );
      expect(delivery.steeredThreads).toHaveLength(1);
      expect(workers[0]?.steered).toEqual(["never touch x.ts"]);

      workers[0]?.complete("a done");
      yield* waitFor(() => workers.length === 2);
      workers[1]?.complete("a reviewed");
      yield* waitFor(() => workers.length === 3);
      expect(workers[2]?.prompts[0]).toContain("never touch x.ts");
      expect(taskStatus(orchestrator, b.id)).toBe("running");
    }),
  ));

it("re-reads a note at the turn boundary and continues the same thread", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator, workers } = setup();
      const a = yield* create(orchestrator, {
        title: "a",
        currentState: "a is not written",
        goalState: "a works",
      });
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

it("searches reports across tasks and threads", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator, workers } = setup();
      const task = yield* create(orchestrator, {
        title: "a",
        currentState: "a is not written",
        goalState: "a works",
      });
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
