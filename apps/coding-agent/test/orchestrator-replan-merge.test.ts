import { Effect } from "effect";
import { expect, it } from "vite-plus/test";

import orchestratorHarness from "./orchestrator-harness.ts";
import orchestratorReplanSupport from "./orchestrator-replan-support.ts";
import worktreeSupport from "./worktree-support.ts";

const { create, stopAndWrapUp } = orchestratorReplanSupport;
const { harness } = orchestratorHarness;
const { setup, taskStatus, waitFor } = harness;
const { gatedTarget, read } = worktreeSupport;

function rejection(attempt: () => Promise<unknown>) {
  return Effect.promise(() =>
    attempt().then(
      () => "",
      (error: unknown) => String(error),
    ),
  );
}

const refusesToInheritAStartedTarget = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator, workers } = setup();
      const { target } = yield* gatedTarget(orchestrator);
      const part = yield* create(orchestrator, {
        currentState: "c",
        goalState: "d",
        mergeInto: target.id,
        title: "part",
      });
      yield* Effect.promise(() => orchestrator.stop(part.id));
      yield* Effect.promise(() =>
        orchestrator.setDepends({ remove: [part.id], taskIds: [target.id] }),
      );
      workers[0]!.complete("gate done");
      yield* waitFor(() => workers.length === 3);
      workers[2]!.complete("acceptable");
      yield* waitFor(() => taskStatus(orchestrator, target.id) === "running");
      const before = orchestrator.snapshot.tasks.length;

      const refused = yield* rejection(() =>
        orchestrator.replan({
          reason: "the part needs another try",
          stop: false,
          tasks: [{ from: [part.id], title: "part again" }],
        }),
      );

      expect(refused).toContain(`would inherit mergeInto ${target.id} from ${part.id}`);
      expect(refused).toContain(`${target.id} is running`);
      expect(orchestrator.snapshot.tasks).toHaveLength(before);
      expect(taskStatus(orchestrator, part.id)).toBe("stopped");
    }),
  );

it(
  "refuses a replan whose new task would inherit a merge target that has already started",
  refusesToInheritAStartedTarget,
);

const replacesAStartedTargetWithItsSource = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator, workers } = setup();
      const { target } = yield* gatedTarget(orchestrator);
      const part = yield* create(orchestrator, {
        currentState: "c",
        goalState: "d",
        mergeInto: target.id,
        title: "part",
      });
      yield* Effect.promise(() => orchestrator.stop(part.id));
      yield* Effect.promise(() =>
        orchestrator.setDepends({ remove: [part.id], taskIds: [target.id] }),
      );
      workers[0]!.complete("gate done");
      yield* waitFor(() => workers.length === 3);
      workers[2]!.complete("acceptable");
      yield* waitFor(() => taskStatus(orchestrator, target.id) === "running");
      yield* waitFor(() => workers.length === 4);

      const pending = orchestrator.replan({
        reason: "the part and the integration both need another try",
        tasks: [
          { from: [part.id], title: "part again" },
          { from: [target.id], title: "integrate again" },
        ],
      });
      yield* stopAndWrapUp(orchestrator, [workers[3]!], "integrated half");
      const result = yield* Effect.promise(() => pending);
      const [nextPart, nextTarget] = result.created.map((created) => created.taskId);

      expect((yield* read(orchestrator, nextPart!)).mergeInto).toBe(nextTarget);
      expect((yield* read(orchestrator, nextTarget!)).dependsOn).toContain(nextPart);
    }),
  );

it(
  "accepts a replan that replaces a started merge target together with its source, and points the new source at the new target",
  replacesAStartedTargetWithItsSource,
);

const mergesSourceAndTargetIntoOneTask = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator } = setup();
      const { target } = yield* gatedTarget(orchestrator);
      const part = yield* create(orchestrator, {
        currentState: "c",
        goalState: "d",
        mergeInto: target.id,
        title: "part",
      });
      yield* Effect.promise(() => orchestrator.stop(part.id));

      const result = yield* Effect.promise(() =>
        orchestrator.replan({
          reason: "one task can do the part and the integration",
          stop: false,
          tasks: [{ from: [part.id, target.id], title: "part and integrate" }],
        }),
      );
      const next = yield* read(orchestrator, result.created[0]!.taskId);

      expect(next.mergeInto).toBeNull();
      expect(next.dependsOn).not.toContain(next.id);
    }),
  );

it(
  "drops the merge target when one replan entry replaces both a source and the task it merges into",
  mergesSourceAndTargetIntoOneTask,
);
