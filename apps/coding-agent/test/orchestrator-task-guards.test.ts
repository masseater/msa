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
const { create, replan } = orchestratorReplanSupport;
const { harness } = orchestratorHarness;
const { setup, taskStatus, waitFor } = harness;
const { joinPath, makeTempDir, removeDirs, runTest } = testing;

const directories: string[] = [];

afterEach(() => runTest(removeDirs(directories.splice(0))));

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

const attempt = (
  orchestrator: orchestratorTypes.Orchestrator,
  input: { title: string; condition?: string },
) =>
  Effect.promise(() =>
    orchestrator.createTask({ currentState: "not done", goalState: "done", ...input }).then(
      (task) => task.id,
      (error: unknown) => messageOf(error),
    ),
  );

const workTitles = (orchestrator: orchestratorTypes.Orchestrator) =>
  orchestrator.snapshot.tasks.filter((task) => task.kind === "work").map((task) => task.title);

it("refuses to create a task whose title an unfinished task already has, until that task finishes", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator, workers } = setup();
      const a = yield* create(orchestrator, {
        currentState: "the exclusion is in place",
        goalState: "the exclusion is gone",
        title: "remove the release-age exclusion",
      });
      const again = yield* attempt(orchestrator, { title: "  remove the release-age  exclusion " });
      expect(again).toContain(`${a.id} (running) already has this title`);
      expect(workTitles(orchestrator)).toEqual(["remove the release-age exclusion"]);

      workers[0]?.complete("the exclusion is gone");
      yield* waitFor(() => workers.length === 2);
      workers[1]?.complete("reviewed");
      yield* waitFor(() => taskStatus(orchestrator, a.id) === "completed");
      const later = yield* attempt(orchestrator, { title: "remove the release-age exclusion" });
      expect(later).toMatch(/^t-/u);
    }),
  ));

it("refuses a replan that adds a task with the title of an unfinished task it keeps", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator } = setup();
      const a = yield* create(orchestrator, {
        currentState: "lint is pinned",
        goalState: "lint is unpinned",
        title: "unpin lint",
      });
      const twin = yield* Effect.promise(() =>
        replan(orchestrator, {
          keep: [a.id],
          reason: "add the unpin again",
          stop: false,
          tasks: [{ currentState: "pinned", goalState: "unpinned", title: "unpin lint" }],
        }),
      );
      expect(messageOf(twin)).toContain(`${a.id} (running) already has this title`);
      const pair = yield* Effect.promise(() =>
        replan(orchestrator, {
          keep: [a.id],
          reason: "two of the same",
          stop: false,
          tasks: [
            { currentState: "x", goalState: "y", title: "bump zod" },
            { currentState: "x", goalState: "y", title: "bump zod" },
          ],
        }),
      );
      expect(messageOf(pair)).toContain("Two tasks in this replan have the title bump zod");
      expect(workTitles(orchestrator)).toEqual(["unpin lint"]);
    }),
  ));

it("lets a replan reuse the title of the task it replaces", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator } = setup({ maxConcurrent: 1 });
      const a = yield* create(orchestrator, { currentState: "a", goalState: "b", title: "first" });
      const b = yield* create(orchestrator, {
        currentState: "lint is pinned",
        dependsOn: [a.id],
        goalState: "lint is unpinned",
        title: "unpin lint",
      });
      const result = (yield* Effect.promise(() =>
        replan(orchestrator, {
          keep: [a.id],
          reason: "rewrite the unpin",
          stop: false,
          tasks: [{ from: [b.id], title: "unpin lint" }],
        }),
      )) as Awaited<ReturnType<orchestratorTypes.Orchestrator["replan"]>>;
      expect(result.created.map((item) => item.title)).toEqual(["unpin lint"]);
      expect(taskStatus(orchestrator, b.id)).toBe("closed");
    }),
  ));

it("refuses a condition the shell cannot parse and keeps one it can", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator } = setup();
      const broken = yield* attempt(orchestrator, {
        condition: "test (date -u +%s) -ge 1792842010",
        title: "wait for the date",
      });
      expect(broken).toContain("condition does not parse in /bin/sh");
      expect(workTitles(orchestrator)).toEqual([]);
      const fine = yield* attempt(orchestrator, {
        condition: '[ "$(date -u +%s)" -ge 1792842010 ]',
        title: "wait for the date",
      });
      expect(fine).toMatch(/^t-/u);
      expect(workTitles(orchestrator)).toEqual(["wait for the date"]);
    }),
  ));

const legacyReplan = Effect.gen(function* () {
  const directory = yield* makeTempDir("msa-orchestrator-closed-");
  directories.push(directory);
  const path = joinPath(directory, "orchestrator.db");
  const database = store.openDatabase(path);
  const task = (id: string, status: orchestratorTypesTypes.TaskStatus, title: string) => ({
    checks: [],
    condition: null,
    createdAt: 1,
    currentState: "now",
    cwd: "/repo",
    goalState: "later",
    id,
    kind: "work" as const,
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
  store.insertTask(database, task("t-old", "stopped", "port"));
  store.insertTask(database, task("t-new", "completed", "port"));
  store.insertTask(database, task("t-next", "waiting", "docs"));
  store.addDependency(database, "project", "t-next", "t-old");
  replanStore.insertReplan(database, {
    after: {
      created: [{ from: ["t-old"], taskId: "t-new", title: "port" }],
      dropped: [],
      kept: [],
      rewired: [],
      stopped: [],
    },
    createdAt: 1,
    id: "rp-old",
    project: "project",
    reason: "rewrite the port",
  });
  database.close();
  return path;
});

it("closes tasks an earlier msa replaced but left stopped, and starts what waited on them", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const path = yield* legacyReplan;
      const { orchestrator } = setup({ databasePath: path });
      yield* Effect.promise(() => orchestrator.setMaxConcurrentThreads(4));
      expect(taskStatus(orchestrator, "t-old")).toBe("closed");
      const next = orchestrator.snapshot.tasks.find((task) => task.id === "t-next");
      expect(next?.dependsOn).toEqual(["t-new"]);
      yield* waitFor(() => taskStatus(orchestrator, "t-next") === "running");
    }),
  ));
