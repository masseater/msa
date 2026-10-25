import { DatabaseSync } from "node:sqlite";

import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, expect, it } from "vite-plus/test";

import orchestratorHarness from "./orchestrator-harness.ts";
import orchestratorSupport from "./orchestrator-support.ts";
import watchdogSupport from "./orchestrator-watchdog-support.ts";

const { joinPath, makeTempDir, removeDirs, runTest } = testing;
const { setup, taskStatus, waitFor } = orchestratorHarness.harness;
const { create } = orchestratorSupport;
const { TASK } = watchdogSupport;

const directories: string[] = [];

afterEach(() => runTest(removeDirs(directories.splice(0))));

const LIMIT = "You've hit your session limit · resets 8am (Asia/Tokyo)";

function leaveAnUndatedWait(path: string, taskId: string): void {
  const database = new DatabaseSync(path);
  const { thread_id: threadId } = database
    .prepare("SELECT thread_id FROM assignments WHERE task_id = ? AND role = 'worker'")
    .get(taskId) as { thread_id: string };
  database.exec(`
    DROP TABLE provider_waits;
    CREATE TABLE provider_waits (
      task_id TEXT PRIMARY KEY, project TEXT NOT NULL, thread_id TEXT NOT NULL, role TEXT NOT NULL,
      session_file TEXT, reason TEXT NOT NULL, error TEXT NOT NULL, resume_at INTEGER,
      created_at INTEGER NOT NULL
    );
  `);
  database
    .prepare(
      `INSERT INTO provider_waits VALUES (?, 'project', ?, 'worker', NULL, 'quota', ?, NULL, 1)`,
    )
    .run(taskId, threadId, LIMIT);
  database.prepare("UPDATE tasks SET status = 'waiting' WHERE id = ?").run(taskId);
  database.close();
}

const movesAnUndatedWaitToNeedsDecision = Effect.gen(function* () {
  const directory = yield* makeTempDir("msa-provider-stall-");
  directories.push(directory);
  const databasePath = joinPath(directory, "orchestrator.db");
  const first = setup({ databasePath });
  const task = yield* create(first.orchestrator, TASK);
  const sessionFile = first.workers[0]?.sessionFile;
  yield* Effect.promise(() => first.orchestrator.dispose());
  leaveAnUndatedWait(databasePath, task.id);

  const reopened = setup({ databasePath });
  expect(taskStatus(reopened.orchestrator, task.id)).toBe("needs-decision");
  expect(reopened.workers).toHaveLength(0);
  const view = yield* Effect.promise(() => reopened.orchestrator.read(task.id));
  expect(view.reports.at(-1)?.content).toContain("The work is not moving: the provider limit");
  const waits = reopened.orchestrator.database
    .prepare("SELECT COUNT(*) AS count FROM provider_waits")
    .get() as { count: number };
  expect(waits.count).toBe(0);
  const resumeAt = (
    reopened.orchestrator.database.prepare("PRAGMA table_info(provider_waits)").all() as {
      name: string;
      notnull: number;
    }[]
  ).find((column) => column.name === "resume_at");
  expect(resumeAt?.notnull).toBe(1);

  yield* Effect.promise(() => reopened.orchestrator.sendMessage(task.id, "Go on."));
  yield* waitFor(() => reopened.workers.length === 1);
  expect(reopened.workers[0]?.openedSessionFile).toBe(sessionFile);
  expect(reopened.workers[0]?.prompts[0]).toContain("Go on.");
  expect(taskStatus(reopened.orchestrator, task.id)).toBe("running");
  yield* Effect.promise(() => reopened.orchestrator.dispose());
});

it("moves a provider wait left without a resume time into needs-decision when the database opens, and answering reopens the same session", () =>
  runTest(movesAnUndatedWaitToNeedsDecision));
