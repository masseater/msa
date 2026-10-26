import { Effect } from "effect";
import { expect, it } from "vite-plus/test";

import type orchestratorTypes from "../src/core/orchestrator/orchestrator.types.ts";
import orchestratorHarness from "./orchestrator-harness.ts";
import orchestratorReplanSupport from "./orchestrator-replan-support.ts";

const { create, read, replan, stopAndWrapUp } = orchestratorReplanSupport;

const { harness } = orchestratorHarness;

const { setup, taskStatus, waitFor } = harness;

const keepsATaskResumesItInA = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator, workers } = setup();
      const a = yield* create(orchestrator, {
        currentState: "a is not written",
        goalState: "a works",
        title: "a",
      });

      const pending = replan(orchestrator, { keep: [a.id], reason: "same plan" });
      yield* stopAndWrapUp(orchestrator, [workers[0]!], "two checks still failing");

      const result = (yield* Effect.promise(() => pending)) as Awaited<
        ReturnType<orchestratorTypes.Orchestrator["replan"]>
      >;
      expect(result.kept).toEqual([a.id]);
      expect(result.started).toEqual([a.id]);
      yield* waitFor(() => workers.length === 2);
      expect(workers[1]?.prompts[0]).toContain("a is not written");
      expect(workers[1]?.prompts[0]).toContain("a works");
      expect(workers[1]?.prompts[0]).toContain("two checks still failing");
      expect(taskStatus(orchestrator, a.id)).toBe("running");
    }),
  );

it(
  "keeps a task, resumes it in a new thread, and puts the memo in the prompt",
  keepsATaskResumesItInA,
);

const closesADroppedTaskWithItsReason = () =>
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

      const pending = replan(orchestrator, {
        drop: [{ reason: "a already does it", taskId: b.id }],
        keep: [a.id],
        reason: "a covers b",
      });
      yield* stopAndWrapUp(orchestrator, [workers[0]!], "a is done");

      const result = (yield* Effect.promise(() => pending)) as Awaited<
        ReturnType<orchestratorTypes.Orchestrator["replan"]>
      >;
      expect(result.dropped).toEqual([{ reason: "a already does it", taskId: b.id, title: "b" }]);
      const dropped = yield* read(orchestrator, b.id);
      expect(dropped.status).toBe("closed");
      expect(dropped.reports.at(-1)?.content).toContain("a already does it");
      const review = orchestrator.snapshot.tasks.find((task) => task.kind === "review");
      expect(review?.dependsOn).not.toContain(b.id);
    }),
  );

it(
  "closes a dropped task with its reason and lets the round review go",
  closesADroppedTaskWithItsReason,
);

const mergesSeveralTasksIntoOneAndCarries = () =>
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

      const pending = replan(orchestrator, {
        reason: "a and b are one change",
        tasks: [{ from: [a.id, b.id], title: "ab" }],
      });
      yield* stopAndWrapUp(orchestrator, [workers[0]!], "half of a is done");

      const result = (yield* Effect.promise(() => pending)) as Awaited<
        ReturnType<orchestratorTypes.Orchestrator["replan"]>
      >;
      const merged = result.created[0]!;
      expect(merged.from).toEqual([a.id, b.id]);
      expect(taskStatus(orchestrator, a.id)).toBe("closed");
      expect(taskStatus(orchestrator, b.id)).toBe("closed");
      yield* waitFor(() => workers.length === 2);
      expect(workers[1]?.prompts[0]).toContain("a is not written");
      expect(workers[1]?.prompts[0]).toContain("b is not written");
      expect(workers[1]?.prompts[0]).toContain("a works");
      expect(workers[1]?.prompts[0]).toContain("b works");
      expect(workers[1]?.prompts[0]).toContain("half of a is done");
      const view = yield* read(orchestrator, merged.taskId);
      expect(view.dependsOn).toEqual([]);
    }),
  );

it(
  "merges several tasks into one and carries their states and memo",
  mergesSeveralTasksIntoOneAndCarries,
);

const rewiresWaitingWorkWithoutStoppingAnythingWhen = () =>
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

      const result = yield* Effect.promise(() =>
        orchestrator.replan({
          keep: [a.id, b.id],
          reason: "b needs the split first",
          rewire: [{ dependsOn: ["half"], taskId: b.id }],
          stop: false,
          tasks: [
            {
              currentState: "half is not written",
              dependsOn: [a.id],
              goalState: "half works",
              key: "half",
              title: "half",
            },
          ],
        }),
      );
      expect(result.stopped).toEqual([]);
      expect(result.created).toHaveLength(1);
      expect(workers[0]?.prompts).toHaveLength(1);
      expect(taskStatus(orchestrator, a.id)).toBe("running");
      const view = yield* read(orchestrator, b.id);
      expect(view.dependsOn).toEqual([result.created[0]!.taskId]);
    }),
  );

it(
  "rewires waiting work without stopping anything when stop is false",
  rewiresWaitingWorkWithoutStoppingAnythingWhen,
);
