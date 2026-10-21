import { Effect } from "effect";
import { expect, it } from "vite-plus/test";

import storeModule from "../src/core/orchestrator/store.ts";
import orchestratorHarness from "./orchestrator-harness.ts";
import orchestratorSupport from "./orchestrator-support.ts";

const { store } = storeModule;

const { create } = orchestratorSupport;

const { harness } = orchestratorHarness;

const { setup, taskStatus, waitFor } = harness;

const steersRunningThreadsWithASharedNote = () =>
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
      const delivery = yield* Effect.promise(() =>
        orchestrator.sendNote({ audience: "all", content: "never touch x.ts" }),
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
  );

it(
  "steers running threads with a shared note and delivers it to waiting tasks",
  steersRunningThreadsWithASharedNote,
);

const reReadsANoteAtTheTurn = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator, workers } = setup();
      const a = yield* create(orchestrator, {
        currentState: "a is not written",
        goalState: "a works",
        title: "a",
      });
      workers[0]?.complete("first pass");
      store.insertNote(orchestrator.database, {
        author: "test",
        content: "continue with the cache fix",
        createdAt: 1,
        id: "note-boundary",
        project: "project",
        round: null,
        taskIds: [a.id],
      });
      yield* waitFor(() => (workers[0]?.prompts.length ?? 0) === 2);
      expect(workers).toHaveLength(1);
      expect(workers[0]?.prompts[1]).toContain("continue with the cache fix");
    }),
  );

it("re-reads a note at the turn boundary and continues the same thread", reReadsANoteAtTheTurn);

const searchesReportsAcrossTasksAndThreads = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator, workers } = setup();
      const task = yield* create(orchestrator, {
        currentState: "a is not written",
        goalState: "a works",
        title: "a",
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
  );

it("searches reports across tasks and threads", searchesReportsAcrossTasksAndThreads);
