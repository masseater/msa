import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, expect, it } from "vite-plus/test";

import replanStoreModule from "../src/core/orchestrator/replan-store.ts";
import storeModule from "../src/core/orchestrator/store.ts";
import type orchestratorTypesTypes from "../src/core/orchestrator/types.types.ts";
import orchestratorHarness from "./orchestrator-harness.ts";
import orchestratorReplanSupport from "./orchestrator-replan-support.ts";

const { store } = storeModule;
const { replanStore } = replanStoreModule;
const { create } = orchestratorReplanSupport;
const { harness } = orchestratorHarness;
const { setup, taskStatus, waitFor } = harness;
const { joinPath, makeTempDir, removeDirs, runTest } = testing;

const directories: string[] = [];

afterEach(() => runTest(removeDirs(directories.splice(0))));

const task = (
  id: string,
  status: orchestratorTypesTypes.TaskStatus,
  title: string,
): orchestratorTypesTypes.Task => ({
  checks: [],
  condition: null,
  createdAt: 1,
  currentState: "now",
  cwd: "/repo",
  goalState: "later",
  id,
  kind: "work",
  mergeInto: null,
  model: null,
  project: "project",
  round: "main",
  status,
  thinkingLevel: null,
  title,
  updatedAt: 1,
});

const rows = (path: string, sql: string) => {
  const database = store.openDatabase(path);
  const found = database.prepare(sql).all();
  database.close();
  return found;
};

const replannedAndRerunByOlderMsa = Effect.gen(function* () {
  const directory = yield* makeTempDir("msa-orchestrator-older-rerun-");
  directories.push(directory);
  const path = joinPath(directory, "orchestrator.db");
  const database = store.openDatabase(path);
  for (const [id, status, title] of [
    ["t-dropped", "stopped", "port"],
    ["t-running", "stopped", "docs"],
    ["t-done", "stopped", "bump"],
    ["t-heir", "needs-decision", "bump again"],
    ["t-after", "waiting", "release"],
    ["t-halted", "stopped", "halted by stop_task"],
    ["t-failed", "failed", "crashed"],
    ["t-asking", "needs-decision", "asking"],
  ] as const) {
    store.insertTask(database, task(id, status, title));
  }
  replanStore.insertReplan(database, {
    after: {
      created: [{ from: ["t-done", "t-running"], taskId: "t-heir", title: "bump again" }],
      dropped: [{ reason: "not needed", taskId: "t-dropped", title: "port" }],
      kept: [],
      rewired: [],
      stopped: [],
    },
    createdAt: 1,
    id: "rp-1",
    project: "project",
    reason: "rewrite the bump",
  });
  database.exec("INSERT INTO task_dependencies (task_id, depends_on) VALUES ('t-after', 't-done')");
  database.exec("UPDATE tasks SET status = 'waiting' WHERE id = 't-dropped'");
  database.exec("UPDATE tasks SET status = 'running' WHERE id = 't-running'");
  database.exec("UPDATE tasks SET status = 'completed' WHERE id = 't-done'");
  database.exec(
    `INSERT INTO threads (id, project, model, thinking_level, cwd, status, created_at, updated_at)
     VALUES ('th-old', 'project', 'fast/flash', 'low', '/repo', 'running', 1, 1)`,
  );
  database.exec(
    `INSERT INTO assignments (task_id, thread_id, role, created_at)
     VALUES ('t-running', 'th-old', 'worker', 1)`,
  );
  database.exec("ALTER TABLE tasks DROP COLUMN closed_by");
  database.exec("PRAGMA user_version = 3");
  database.close();
  return path;
});

it("closes every task a replan replaced, even one an older msa reran before this one opened the database", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const path = yield* replannedAndRerunByOlderMsa;
      const { orchestrator, workers } = setup({ databasePath: path });
      yield* Effect.promise(() => orchestrator.setMaxConcurrentThreads(4));
      yield* Effect.sleep(20);
      for (const id of ["t-dropped", "t-running", "t-done"]) {
        expect(taskStatus(orchestrator, id)).toBe("closed");
      }
      expect(taskStatus(orchestrator, "t-halted")).toBe("stopped");
      expect(taskStatus(orchestrator, "t-failed")).toBe("failed");
      expect(taskStatus(orchestrator, "t-asking")).toBe("needs-decision");
      const after = orchestrator.snapshot.tasks.find((item) => item.id === "t-after");
      expect(after?.dependsOn).toEqual(["t-heir"]);
      expect(workers).toHaveLength(0);
      yield* Effect.promise(() => orchestrator.dispose());
      expect(
        rows(path, "SELECT id, status FROM tasks WHERE closed_by IS NOT NULL ORDER BY id"),
      ).toEqual(["t-done", "t-dropped", "t-running"].map((id) => ({ id, status: "stopped" })));
      expect(rows(path, "SELECT status FROM threads WHERE id = 'th-old'")).toEqual([
        { status: "stopped" },
      ]);
    }),
  ));

it("stops the thread of a closed task when the database opens, without an orchestrator", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const path = yield* replannedAndRerunByOlderMsa;
      expect(rows(path, "SELECT status FROM threads WHERE id = 'th-old'")).toEqual([
        { status: "stopped" },
      ]);
      const older = store.openDatabase(path);
      older.exec("UPDATE tasks SET status = 'completed' WHERE id = 't-running'");
      older.exec("UPDATE threads SET status = 'completed' WHERE id = 'th-old'");
      older.close();
      const { orchestrator } = setup({ databasePath: path });
      expect(taskStatus(orchestrator, "t-running")).toBe("closed");
      const after = orchestrator.snapshot.tasks.find((item) => item.id === "t-after");
      expect(after?.dependsOn).toEqual(["t-heir"]);
    }),
  ));

it("keeps a task closed when the run it had already started reports", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const directory = yield* makeTempDir("msa-orchestrator-closed-report-");
      directories.push(directory);
      const path = joinPath(directory, "orchestrator.db");
      const { orchestrator, reports, workers } = setup({ databasePath: path });
      const a = yield* create(orchestrator, {
        currentState: "the docs are stale",
        goalState: "the docs are current",
        title: "update the docs",
      });
      yield* waitFor(() => workers.length === 1);
      const other = store.openDatabase(path);
      store.closeTask(other, a.id, "rp-elsewhere", 2);
      other.close();
      workers[0]?.complete("the docs are current");
      yield* waitFor(() => reports.length > 0);
      yield* Effect.sleep(20);
      expect(taskStatus(orchestrator, a.id)).toBe("closed");
      expect(workers).toHaveLength(1);
      const reviewing = orchestrator.snapshot.tasks.filter(
        (item) => item.kind === "review" && item.status === "running",
      );
      expect(reviewing).toEqual([]);
    }),
  ));
