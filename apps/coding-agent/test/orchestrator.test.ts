import { DatabaseSync } from "node:sqlite";

import testing from "@msa/testing";
import { Effect, Result } from "effect";
import { expect, it } from "vite-plus/test";

import errors from "../src/core/orchestrator/errors.ts";
import type orchestratorTypes from "../src/core/orchestrator/orchestrator.types.ts";
import promptsModule from "../src/core/orchestrator/prompts.ts";
import orchestratorHarness from "./orchestrator-harness.ts";
import orchestratorSupport from "./orchestrator-support.ts";

const { orchestratorError } = errors;

const { makeTempDir, removePath } = testing;

const { create } = orchestratorSupport;

const { harness } = orchestratorHarness;

const { setup, taskStatus, waitFor } = harness;

const read = (orchestrator: orchestratorTypes.Orchestrator, id: string) =>
  Effect.promise(() => orchestrator.read(id));

const buildsTheWorkerPromptFromTheTwo = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator, workers } = setup();
      yield* create(orchestrator, {
        currentState: "src/cache.ts has no cache and repeated reads go to the network",
        goalState: "repeated reads hit the cache and a test covers the second read",
        title: "cache reads",
      });
      expect(workers[0]?.prompts[0]).toBe(
        [
          "<current-state>\nsrc/cache.ts has no cache and repeated reads go to the network\n</current-state>",
          "<goal-state>\nrepeated reads hit the cache and a test covers the second read\n</goal-state>",
          promptsModule.prompts.GOAL_RULE,
        ].join("\n\n"),
      );
    }),
  );

it(
  "builds the worker prompt from the two states and the rule against narrowing the goal, and nothing else",
  buildsTheWorkerPromptFromTheTwo,
);

const opensADatabaseFromBeforeTheTaskSetup = () =>
  Effect.gen(function* () {
    const directory = yield* makeTempDir("msa-orchestrator-legacy-");
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
    return { directory, legacy, path };
  });

const opensADatabaseFromBeforeTheTask = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { directory, legacy, path } = yield* opensADatabaseFromBeforeTheTaskSetup();
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
          currentState: "the new work is not started",
          goalState: "the new work is done",
          title: "new work",
        });
        const created = orchestrator.snapshot.tasks.find(
          (candidate) => candidate.title === "new work",
        );
        expect(created?.currentState).toBe("the new work is not started");
      } finally {
        yield* Effect.promise(() => orchestrator.dispose());
        yield* removePath(directory);
      }
    }),
  );

it(
  "opens a database from before the task states and keeps its tasks",
  opensADatabaseFromBeforeTheTask,
);

const rejectsATaskWithoutACurrentState = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator, workers } = setup();
      type CreateInput = Parameters<orchestratorTypes.Orchestrator["createTask"]>[0];
      const reject = (input: CreateInput) =>
        Effect.result(
          Effect.tryPromise({
            catch: orchestratorError,
            try: () => orchestrator.createTask(input),
          }),
        );
      const withoutGoal = yield* reject({
        currentState: "a is not written",
        title: "a",
      } as CreateInput);
      expect(Result.isFailure(withoutGoal)).toBe(true);
      if (Result.isFailure(withoutGoal)) {
        expect(withoutGoal.failure.message).toContain("goal state");
      }
      const blankCurrent = yield* reject({
        currentState: "  ",
        goalState: "b works",
        title: "b",
      } as CreateInput);
      expect(Result.isFailure(blankCurrent)).toBe(true);
      if (Result.isFailure(blankCurrent)) {
        expect(blankCurrent.failure.message).toContain("current state");
      }
      expect(orchestrator.snapshot.tasks).toEqual([]);
      expect(workers).toHaveLength(0);
    }),
  );

it("rejects a task without a current state or a goal state", rejectsATaskWithoutACurrentState);

const runsAWorkerThenASeparateReviewer = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator, workers } = setup();
      const task = yield* create(orchestrator, {
        currentState: "a is not written",
        goalState: "a works",
        title: "a",
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
  );

it(
  "runs a worker, then a separate reviewer thread with the review model",
  runsAWorkerThenASeparateReviewer,
);

const waitsForDependenciesAndPassesTheReports = () =>
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
  );

it("waits for dependencies and passes the reports on", waitsForDependenciesAndPassesTheReports);

const keepsAMessageToAWaitingTask = () =>
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
  );

it(
  "keeps a message to a waiting task and adds it to the prompt at start",
  keepsAMessageToAWaitingTask,
);
