import testing from "@msa/testing";
import { Effect } from "effect";
import { expect, it } from "vite-plus/test";

import orchestratorHarness from "./orchestrator-harness.ts";
import orchestratorReplanSupport from "./orchestrator-replan-support.ts";
import orchestratorSupport from "./orchestrator-support.ts";

const { runTest } = testing;
const { create } = orchestratorSupport;
const { replan, stopAndWrapUp } = orchestratorReplanSupport;
const { harness } = orchestratorHarness;
const { setup, taskStatus, waitFor } = harness;

const twoTasks = Effect.gen(function* () {
  const { orchestrator, workers } = setup();
  const a = yield* create(orchestrator, {
    currentState: "a is not written",
    goalState: "a works",
    title: "a",
  });
  const b = yield* create(orchestrator, {
    currentState: "b is not written",
    goalState: "b works",
    title: "b",
  });
  yield* waitFor(() => workers.length === 2);
  return { a, b, orchestrator, workers };
});

it("stops the pr watches of a thread that completes, and only that thread's", () =>
  runTest(
    Effect.gen(function* () {
      const { workers } = yield* twoTasks;
      expect(workers.map((worker) => worker.prWatchClosed)).toEqual([0, 0]);
      workers[0]?.complete("done");
      yield* waitFor(() => workers.length === 3);
      expect(workers.map((worker) => worker.prWatchClosed)).toEqual([1, 0, 0]);
    }),
  ));

it("stops the pr watches of a thread that fails", () =>
  runTest(
    Effect.gen(function* () {
      const { a, orchestrator, workers } = yield* twoTasks;
      workers[0]?.fail(new Error("provider down"));
      yield* waitFor(() => taskStatus(orchestrator, a.id) === "failed");
      expect(workers.map((worker) => worker.prWatchClosed)).toEqual([1, 0]);
    }),
  ));

it("stops the pr watches of a thread whose task is stopped", () =>
  runTest(
    Effect.gen(function* () {
      const { a, orchestrator, workers } = yield* twoTasks;
      yield* Effect.promise(() => orchestrator.stop(a.id));
      expect(workers.map((worker) => worker.prWatchClosed)).toEqual([1, 0]);
    }),
  ));

it("stops the pr watches of a thread the watchdog stops", () =>
  runTest(
    Effect.gen(function* () {
      const { orchestrator, workers } = setup({ watchdog: { idleMs: 50, intervalMs: 10 } });
      const a = yield* create(orchestrator, {
        currentState: "a is not written",
        goalState: "a works",
        title: "a",
      });
      yield* waitFor(() => taskStatus(orchestrator, a.id) === "stopped");
      expect(workers[0]?.prWatchClosed).toBe(1);
      yield* Effect.promise(() => orchestrator.dispose());
    }),
  ));

it("stops the pr watches of a thread that wraps up for a replan", () =>
  runTest(
    Effect.gen(function* () {
      const { orchestrator, workers } = setup();
      const a = yield* create(orchestrator, {
        currentState: "the client still speaks v2",
        goalState: "the client speaks v3",
        title: "a",
      });
      const pending = replan(orchestrator, {
        reason: "the api moved to v3",
        tasks: [{ from: [a.id], title: "a client" }],
      });
      yield* stopAndWrapUp(orchestrator, [workers[0]!], "branch feat/a, nothing left");
      yield* Effect.promise(() => pending);
      expect(taskStatus(orchestrator, a.id)).toBe("stopped");
      expect(workers[0]?.prWatchClosed).toBe(1);
    }),
  ));
