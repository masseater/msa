import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, expect, it } from "vite-plus/test";

import type orchestratorTypes from "../src/core/orchestrator/orchestrator.types.ts";
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

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

const settle = <A>(promise: Promise<A>) =>
  Effect.promise(() =>
    promise.then(
      () => "accepted",
      (error: unknown) => messageOf(error),
    ),
  );

const attempt = (
  orchestrator: orchestratorTypes.Orchestrator,
  input: { title: string; dependsOn?: string[] },
) =>
  Effect.promise(() =>
    orchestrator.createTask({ currentState: "not done", goalState: "done", ...input }).then(
      (task) => task.id,
      (error: unknown) => messageOf(error),
    ),
  );

it("treats titles that differ in more than spacing as different tasks", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator } = setup({ maxConcurrent: 1 });
      const pairs = [
        ["手順①を直す", "手順1を直す"],
        ["PR＃７４", "PR#74"],
        ["ｶﾀｶﾅ", "カタカナ"],
      ] as const;
      const first = yield* create(orchestrator, {
        currentState: "not done",
        goalState: "done",
        title: pairs[0][0],
      });
      for (const [index, [left, right]] of pairs.entries()) {
        if (index > 0) {
          expect(yield* attempt(orchestrator, { dependsOn: [first.id], title: left })).toMatch(
            /^t-/u,
          );
        }
        expect(yield* attempt(orchestrator, { dependsOn: [first.id], title: right })).toMatch(
          /^t-/u,
        );
      }
      const spaced = yield* attempt(orchestrator, {
        dependsOn: [first.id],
        title: " PR＃７４　",
      });
      expect(spaced).toContain("already has this title");
    }),
  ));

it("refuses a task with the title of a failed task, which rerun can resume", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator, workers } = setup();
      const a = yield* create(orchestrator, {
        currentState: "the build is red",
        goalState: "the build is green",
        title: "fix the build",
      });
      workers[0]?.fail(new Error("worker crashed"));
      yield* waitFor(() => taskStatus(orchestrator, a.id) === "failed");
      const again = yield* attempt(orchestrator, { title: "fix the build" });
      expect(again).toContain(`${a.id} (failed) already has this title`);
    }),
  ));

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
  opensPullRequest: true,
  project: "project",
  round: "main",
  status,
  thinkingLevel: null,
  title,
  updatedAt: 1,
});

const reopenedByOlderMsa = Effect.gen(function* () {
  const directory = yield* makeTempDir("msa-orchestrator-reopened-");
  directories.push(directory);
  const path = joinPath(directory, "orchestrator.db");
  const database = store.openDatabase(path);
  store.insertTask(database, task("t-waiting", "stopped", "port"));
  store.insertTask(database, task("t-running", "stopped", "docs"));
  store.insertTask(database, { ...task("t-conditioned", "stopped", "wait"), condition: "true" });
  store.insertTask(database, task("t-done", "stopped", "bump"));
  store.insertTask(database, task("t-heir", "needs-decision", "bump again"));
  store.insertTask(database, task("t-after", "waiting", "release"));
  for (const id of ["t-waiting", "t-running", "t-conditioned", "t-done"]) {
    store.closeTask(database, id, "rp-1", 1);
  }
  replanStore.insertReplan(database, {
    after: {
      created: [{ from: ["t-done"], taskId: "t-heir", title: "bump again" }],
      dropped: [],
      kept: [],
      rewired: [],
      stopped: [],
    },
    createdAt: 1,
    id: "rp-1",
    project: "project",
    reason: "rewrite the bump",
  });
  database.exec("UPDATE tasks SET status = 'waiting' WHERE id IN ('t-waiting', 't-conditioned')");
  database.exec("UPDATE tasks SET status = 'running' WHERE id = 't-running'");
  database.exec("UPDATE tasks SET status = 'completed' WHERE id = 't-done'");
  database.exec("INSERT INTO task_dependencies (task_id, depends_on) VALUES ('t-after', 't-done')");
  database.close();
  return path;
});

it("keeps a closed task closed after an older msa reran it", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const path = yield* reopenedByOlderMsa;
      const { orchestrator, workers } = setup({ databasePath: path });
      yield* Effect.promise(() => orchestrator.setMaxConcurrentThreads(4));
      for (const id of ["t-waiting", "t-running", "t-conditioned", "t-done"]) {
        expect(taskStatus(orchestrator, id)).toBe("closed");
        expect(yield* settle(orchestrator.rerun(id))).toContain("closed by a replan");
        expect(yield* settle(orchestrator.sendMessage(id, "carry on"))).toContain(
          "closed by a replan",
        );
      }
      const dependent = yield* attempt(orchestrator, { dependsOn: ["t-waiting"], title: "later" });
      expect(dependent).toContain("cannot depend on t-waiting");
      const after = orchestrator.snapshot.tasks.find((item) => item.id === "t-after");
      expect(after?.dependsOn).toEqual(["t-heir"]);
      yield* Effect.sleep(20);
      expect(workers).toHaveLength(0);
      const raw = store.openDatabase(path);
      const rows = raw
        .prepare("SELECT id, status FROM tasks WHERE closed_by IS NOT NULL ORDER BY id")
        .all();
      raw.close();
      expect(rows).toEqual(
        ["t-conditioned", "t-done", "t-running", "t-waiting"].map((id) => ({
          id,
          status: "stopped",
        })),
      );
    }),
  ));

it("neither schedules nor requeues a closed task an older msa reopens while this one runs", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const path = yield* reopenedByOlderMsa;
      const commands: string[] = [];
      const { orchestrator, workers } = setup({
        databasePath: path,
        pollIntervalMs: 2,
        runCommand: (command) => {
          commands.push(command);
          return Promise.resolve({ exitCode: 0, output: "" });
        },
      });
      const other = store.openDatabase(path);
      other.exec("UPDATE tasks SET status = 'waiting' WHERE id IN ('t-waiting', 't-conditioned')");
      other.exec("UPDATE tasks SET status = 'running' WHERE id = 't-running'");
      other.exec("UPDATE tasks SET status = 'completed' WHERE id = 't-done'");
      other.exec("DELETE FROM task_dependencies WHERE task_id = 't-after'");
      other.exec(
        "INSERT INTO task_dependencies (task_id, depends_on) VALUES ('t-after', 't-done')",
      );
      yield* Effect.promise(() => orchestrator.setMaxConcurrentThreads(4));
      yield* Effect.sleep(20);
      expect(workers).toHaveLength(0);
      expect(taskStatus(orchestrator, "t-waiting")).toBe("closed");
      expect(taskStatus(orchestrator, "t-after")).toBe("waiting");
      expect(commands).toEqual([]);
      yield* Effect.promise(() => orchestrator.dispose());
      const requeued = other.prepare("SELECT status FROM tasks WHERE id = 't-running'").get() as {
        status: string;
      };
      other.close();
      expect(requeued.status).toBe("stopped");
    }),
  ));
