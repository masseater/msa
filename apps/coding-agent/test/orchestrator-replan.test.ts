import testing from "@msa/testing";
import { Effect, Result } from "effect";
import { expect, it } from "vite-plus/test";

import { orchestratorError } from "../src/core/orchestrator/errors.ts";
import type { Orchestrator } from "../src/core/orchestrator/orchestrator.ts";
import orchestratorHarness from "./orchestrator-harness.ts";
import orchestratorReplanSupport from "./orchestrator-replan-support.ts";

const { runTest } = testing;

const { create, read, replan, stopAndWrapUp } = orchestratorReplanSupport;

const { harness } = orchestratorHarness;

const { setup, taskStatus, waitFor } = harness;

const stopsAtTheTurnBoundaryHandsThePart1 = () =>
  Effect.gen(function* () {
    const { orchestrator, workers } = setup();
    const a = yield* create(orchestrator, {
      currentState: "the client still speaks v2",
      goalState: "the client speaks v3",
      title: "a",
    });
    return { a, orchestrator, workers };
  });

const stopsAtTheTurnBoundaryHandsThe = Effect.gen(function* () {
  const { a, orchestrator, workers } = yield* stopsAtTheTurnBoundaryHandsThePart1();
  const memo = "branch feat/a, commit abc123 port the client, 2 checks still failing";

  const pending = replan(orchestrator, {
    reason: "the api moved to v3",
    tasks: [
      { from: [a.id], goalState: "the client speaks v3", title: "a client" },
      { from: [a.id], title: "a docs" },
    ],
  });

  yield* waitFor(() => orchestrator.replanning);
  workers[0]?.complete("first pass");
  yield* waitFor(() => (workers[0]?.prompts.length ?? 0) === 2);
  expect(workers[0]?.prompts[1]).toContain("Commit and push");
  expect(taskStatus(orchestrator, a.id)).toBe("running");

  workers[0]?.complete(memo);
  const result = (yield* Effect.promise(() => pending)) as Awaited<
    ReturnType<Orchestrator["replan"]>
  >;

  expect(result.aborted).toBeNull();
  expect(result.stopped.map((item) => item.taskId)).toEqual([a.id]);
  expect(result.stopped[0]?.memo).toBe(memo);
  expect(result.created.map((item) => item.title)).toEqual(["a client", "a docs"]);
  expect(taskStatus(orchestrator, a.id)).toBe("stopped");

  yield* waitFor(() => workers.length === 3);
  const [client, docs] = result.created;
  const clientPrompt = workers[1]?.prompts[0] ?? "";
  expect(clientPrompt).toContain("the client speaks v3");
  expect(clientPrompt).toContain("the client still speaks v2");
  expect(clientPrompt).toContain(memo);
  expect(clientPrompt).toContain("the api moved to v3");
  expect(workers[2]?.prompts[0] ?? "").toContain("the client still speaks v2");
  expect(workers[2]?.prompts[0] ?? "").toContain("the client speaks v3");
  expect(workers[2]?.prompts[0] ?? "").toContain(memo);

  const clientView = yield* read(orchestrator, client!.taskId);
  expect(clientView.dependsOn).toEqual([]);
  expect(clientView.round).toBe("main");
  const source = yield* read(orchestrator, a.id);
  expect(source.reports.at(-1)?.status).toBe("stopped");
  expect(source.reports.at(-1)?.content).toContain(memo);
  expect(docs?.taskId).not.toBe(client?.taskId);
});

it("stops at the turn boundary, hands the memo to the split tasks, and resumes them", () =>
  runTest(stopsAtTheTurnBoundaryHandsThe));

const abortsWithoutTouchingThePlanWhenThe = Effect.gen(function* () {
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
    drop: [{ reason: "not needed", taskId: b.id }],
    reason: "new plan",
    tasks: [{ from: [a.id], goalState: "a works again", title: "a2" }],
  });
  yield* waitFor(() => orchestrator.replanning);
  workers[0]?.complete("first pass");
  yield* waitFor(() => (workers[0]?.prompts.length ?? 0) === 2);
  workers[0]?.fail(new Error("push rejected"));

  const result = (yield* Effect.promise(() => pending)) as Awaited<
    ReturnType<Orchestrator["replan"]>
  >;
  expect(result.aborted).toContain("push rejected");
  expect(result.created).toEqual([]);
  expect(result.dropped).toEqual([]);
  expect(taskStatus(orchestrator, b.id)).toBe("waiting");
  const tasks = orchestrator.snapshot.tasks.map((task) => task.title);
  expect(tasks).not.toContain("a2");
  expect(orchestrator.snapshot.replans).toEqual([]);
});

it("aborts without touching the plan when the wrap-up fails", () =>
  runTest(abortsWithoutTouchingThePlanWhenThe));

const rejectsACycleAmongTheNewTasks = Effect.gen(function* () {
  const { orchestrator, workers } = setup();
  const a = yield* create(orchestrator, {
    currentState: "a is not written",
    goalState: "a works",
    title: "a",
  });
  const before = orchestrator.snapshot.tasks.length;

  const result = yield* Effect.result(
    Effect.tryPromise({
      catch: orchestratorError,
      try: () =>
        orchestrator.replan({
          keep: [a.id],
          reason: "new plan",
          stop: false,
          tasks: [
            {
              currentState: "one is not written",
              dependsOn: ["two"],
              goalState: "one works",
              key: "one",
              title: "one",
            },
            {
              currentState: "two is not written",
              dependsOn: ["one"],
              goalState: "two works",
              key: "two",
              title: "two",
            },
          ],
        }),
    }),
  );
  expect(Result.isFailure(result)).toBe(true);
  if (Result.isFailure(result)) expect(result.failure.message).toContain("cycle");
  expect(orchestrator.snapshot.tasks).toHaveLength(before);
  expect(orchestrator.snapshot.replans).toEqual([]);
  expect(workers).toHaveLength(1);
});

it("rejects a cycle among the new tasks and writes nothing", () =>
  runTest(rejectsACycleAmongTheNewTasks));

const rejectsANewTaskWithoutACurrent = Effect.gen(function* () {
  const { orchestrator, workers } = setup();
  yield* create(orchestrator, {
    currentState: "a is not written",
    goalState: "a works",
    title: "a",
  });
  const before = orchestrator.snapshot.tasks.length;

  const result = yield* Effect.result(
    Effect.tryPromise({
      catch: orchestratorError,
      try: () =>
        orchestrator.replan({
          reason: "new plan",
          stop: false,
          tasks: [{ currentState: "half is not written", title: "half" }],
        }),
    }),
  );
  expect(Result.isFailure(result)).toBe(true);
  if (Result.isFailure(result)) expect(result.failure.message).toContain("goal state");
  expect(orchestrator.snapshot.tasks).toHaveLength(before);
  expect(workers).toHaveLength(1);
});

it("rejects a new task without a current state or a goal state", () =>
  runTest(rejectsANewTaskWithoutACurrent));

const rewiresAKeptTaskOntoTheTasks = Effect.gen(function* () {
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
    keep: [b.id],
    reason: "split a",
    rewire: [{ dependsOn: ["a1"], taskId: b.id }],
    tasks: [{ from: [a.id], goalState: "the first half works", key: "a1", title: "a1" }],
  });
  yield* stopAndWrapUp(orchestrator, [workers[0]!], "half of a is done");

  const result = (yield* Effect.promise(() => pending)) as Awaited<
    ReturnType<Orchestrator["replan"]>
  >;
  const created = result.created[0]!;
  const view = yield* read(orchestrator, b.id);
  expect(view.dependsOn).toEqual([created.taskId]);
  expect(view.status).toBe("waiting");
});

it("rewires a kept task onto the tasks that replace another one", () =>
  runTest(rewiresAKeptTaskOntoTheTasks));
