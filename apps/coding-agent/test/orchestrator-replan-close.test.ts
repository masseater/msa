import { Effect } from "effect";
import { expect, it } from "vite-plus/test";

import type orchestratorTypes from "../src/core/orchestrator/orchestrator.types.ts";
import orchestratorHarness from "./orchestrator-harness.ts";
import orchestratorReplanSupport from "./orchestrator-replan-support.ts";

const { create, replan, stopAndWrapUp } = orchestratorReplanSupport;
const { harness } = orchestratorHarness;
const { setup, taskStatus, waitFor } = harness;

type ReplanResult = Awaited<ReturnType<orchestratorTypes.Orchestrator["replan"]>>;

const dependsOn = (orchestrator: orchestratorTypes.Orchestrator, id: string) =>
  orchestrator.snapshot.tasks.find((task) => task.id === id)?.dependsOn;

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

const replaceRunningTask = Effect.gen(function* () {
  const harnessed = setup();
  const { orchestrator, workers } = harnessed;
  const a = yield* create(orchestrator, {
    currentState: "the client speaks v2",
    goalState: "the client speaks v3",
    title: "port the client",
  });
  const c = yield* create(orchestrator, {
    currentState: "the docs describe v2",
    dependsOn: [a.id],
    goalState: "the docs describe v3",
    title: "update the docs",
  });
  const pending = replan(orchestrator, {
    reason: "the port needs a new plan",
    tasks: [{ from: [a.id], title: "port the client" }],
  });
  yield* stopAndWrapUp(orchestrator, [workers[0]!], "half of the client is ported");
  const result = (yield* Effect.promise(() => pending)) as ReplanResult;
  return { ...harnessed, a, c, heir: result.created[0]!.taskId, result };
});

it("closes a replaced task and moves the tasks that waited on it to its successor", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator, workers, a, c, heir, result } = yield* replaceRunningTask;
      expect(taskStatus(orchestrator, a.id)).toBe("closed");
      expect(dependsOn(orchestrator, c.id)).toEqual([heir]);
      expect(result.rewired).toEqual([{ dependsOn: [heir], taskId: c.id }]);

      yield* waitFor(() => workers.length === 2);
      workers[1]?.complete("the client speaks v3");
      yield* waitFor(() => workers.length === 3);
      workers[2]?.complete("reviewed");
      yield* waitFor(() => taskStatus(orchestrator, c.id) === "running");
      expect(taskStatus(orchestrator, a.id)).toBe("closed");
    }),
  ));

it("refuses to keep, replace, restart, or depend on a task a replan closed", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator, a, heir } = yield* replaceRunningTask;
      const kept = yield* Effect.promise(() =>
        replan(orchestrator, { keep: [a.id, heir], reason: "resume the old one", stop: false }),
      );
      expect(messageOf(kept)).toContain(`Already closed by an earlier replan: ${a.id}`);
      const replaced = yield* Effect.promise(() =>
        replan(orchestrator, {
          keep: [heir],
          reason: "split it again",
          stop: false,
          tasks: [{ from: [a.id], title: "port the client once more" }],
        }),
      );
      expect(messageOf(replaced)).toContain(`Already closed by an earlier replan: ${a.id}`);
      const message = yield* Effect.promise(() =>
        orchestrator.sendMessage(a.id, "carry on").then(
          () => "sent",
          (error: unknown) => messageOf(error),
        ),
      );
      expect(message).toContain("closed by a replan");
      const rerun = yield* Effect.promise(() =>
        orchestrator.rerun(a.id).then(
          () => "rerun",
          (error: unknown) => messageOf(error),
        ),
      );
      expect(rerun).toContain("closed by a replan");
      const dependent = yield* Effect.promise(() =>
        orchestrator
          .createTask({
            currentState: "no release notes",
            dependsOn: [a.id],
            goalState: "release notes for v3",
            title: "write release notes",
          })
          .then(
            () => "created",
            (error: unknown) => messageOf(error),
          ),
      );
      expect(dependent).toContain(`cannot depend on ${a.id}`);
      expect(taskStatus(orchestrator, a.id)).toBe("closed");
    }),
  ));

it("lets the tasks behind a dropped task start instead of waiting on it", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator, workers } = setup();
      const d = yield* create(orchestrator, {
        currentState: "the cache is cold",
        goalState: "the cache is warm",
        title: "warm the cache",
      });
      const x = yield* create(orchestrator, {
        currentState: "no benchmark",
        dependsOn: [d.id],
        goalState: "a benchmark",
        title: "benchmark",
      });
      const pending = replan(orchestrator, {
        drop: [{ reason: "the cache is gone", taskId: d.id }],
        reason: "no cache any more",
      });
      yield* stopAndWrapUp(orchestrator, [workers[0]!], "nothing to keep");
      yield* Effect.promise(() => pending);
      expect(taskStatus(orchestrator, d.id)).toBe("closed");
      expect(dependsOn(orchestrator, x.id)).toEqual([]);
      yield* waitFor(() => taskStatus(orchestrator, x.id) === "running");
    }),
  ));

it("rejects a replan that makes a task wait on a task it closes", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator } = setup();
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
      const rejected = yield* Effect.promise(() =>
        replan(orchestrator, {
          drop: [{ reason: "a is not needed", taskId: a.id }],
          reason: "rewire b",
          rewire: [{ dependsOn: [a.id], taskId: b.id }],
          stop: false,
        }),
      );
      expect(messageOf(rejected)).toContain(`nothing may depend on them: ${a.id}`);
      expect(taskStatus(orchestrator, a.id)).toBe("running");
    }),
  ));
