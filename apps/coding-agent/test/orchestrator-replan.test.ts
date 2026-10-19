import { Effect, Result } from "effect";
import { expect, it } from "vite-plus/test";

import { orchestratorError } from "../src/core/orchestrator/errors.ts";
import type { Orchestrator } from "../src/core/orchestrator/orchestrator.ts";
import type { ReplanInput } from "../src/core/orchestrator/types.ts";
import { harness } from "./orchestrator-harness.ts";

const { setup, taskStatus, waitFor } = harness;

const create = (orchestrator: Orchestrator, input: Parameters<Orchestrator["createTask"]>[0]) =>
  Effect.promise(() => orchestrator.createTask(input));

const read = (orchestrator: Orchestrator, id: string) =>
  Effect.promise(() => orchestrator.read(id));

function replan(orchestrator: Orchestrator, input: ReplanInput): Promise<unknown> {
  return orchestrator.replan(input).catch((error: unknown) => error);
}

function stopAndWrapUp(
  orchestrator: Orchestrator,
  workers: { prompts: string[]; complete: (reply: string) => void }[],
  memo: string,
) {
  return Effect.gen(function* () {
    yield* waitFor(() => orchestrator.replanning);
    for (const worker of workers) worker.complete("turn done");
    yield* waitFor(() => workers.every((worker) => worker.prompts.length === 2));
    for (const worker of workers) worker.complete(memo);
  });
}

it("stops at the turn boundary, hands the memo to the split tasks, and resumes them", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator, workers } = setup();
      const a = yield* create(orchestrator, {
        title: "a",
        currentState: "the client still speaks v2",
        goalState: "the client speaks v3",
      });
      const memo = "branch feat/a, commit abc123 port the client, 2 checks still failing";

      const pending = replan(orchestrator, {
        reason: "the api moved to v3",
        tasks: [
          { from: [a.id], title: "a client", goalState: "the client speaks v3" },
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
    }),
  ));

it("aborts without touching the plan when the wrap-up fails", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator, workers } = setup();
      const a = yield* create(orchestrator, {
        title: "a",
        currentState: "a is not written",
        goalState: "a works",
      });
      const b = yield* create(orchestrator, {
        title: "b",
        currentState: "b is not written",
        goalState: "b works",
        dependsOn: [a.id],
      });

      const pending = replan(orchestrator, {
        reason: "new plan",
        tasks: [{ from: [a.id], title: "a2", goalState: "a works again" }],
        drop: [{ taskId: b.id, reason: "not needed" }],
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
    }),
  ));

it("rejects a cycle among the new tasks and writes nothing", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator, workers } = setup();
      const a = yield* create(orchestrator, {
        title: "a",
        currentState: "a is not written",
        goalState: "a works",
      });
      const before = orchestrator.snapshot.tasks.length;

      const result = yield* Effect.result(
        Effect.tryPromise({
          try: () =>
            orchestrator.replan({
              reason: "new plan",
              stop: false,
              tasks: [
                {
                  key: "one",
                  title: "one",
                  currentState: "one is not written",
                  goalState: "one works",
                  dependsOn: ["two"],
                },
                {
                  key: "two",
                  title: "two",
                  currentState: "two is not written",
                  goalState: "two works",
                  dependsOn: ["one"],
                },
              ],
              keep: [a.id],
            }),
          catch: orchestratorError,
        }),
      );
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) expect(result.failure.message).toContain("cycle");
      expect(orchestrator.snapshot.tasks).toHaveLength(before);
      expect(orchestrator.snapshot.replans).toEqual([]);
      expect(workers).toHaveLength(1);
    }),
  ));

it("rejects a new task without a current state or a goal state", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator, workers } = setup();
      yield* create(orchestrator, {
        title: "a",
        currentState: "a is not written",
        goalState: "a works",
      });
      const before = orchestrator.snapshot.tasks.length;

      const result = yield* Effect.result(
        Effect.tryPromise({
          try: () =>
            orchestrator.replan({
              reason: "new plan",
              stop: false,
              tasks: [{ title: "half", currentState: "half is not written" }],
            }),
          catch: orchestratorError,
        }),
      );
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) expect(result.failure.message).toContain("goal state");
      expect(orchestrator.snapshot.tasks).toHaveLength(before);
      expect(workers).toHaveLength(1);
    }),
  ));

it("rewires a kept task onto the tasks that replace another one", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator, workers } = setup();
      const a = yield* create(orchestrator, {
        title: "a",
        currentState: "a is not written",
        goalState: "a works",
      });
      const b = yield* create(orchestrator, {
        title: "b",
        currentState: "b is not written",
        goalState: "b works",
        dependsOn: [a.id],
      });

      const pending = replan(orchestrator, {
        reason: "split a",
        tasks: [{ from: [a.id], key: "a1", title: "a1", goalState: "the first half works" }],
        keep: [b.id],
        rewire: [{ taskId: b.id, dependsOn: ["a1"] }],
      });
      yield* stopAndWrapUp(orchestrator, [workers[0]!], "half of a is done");

      const result = (yield* Effect.promise(() => pending)) as Awaited<
        ReturnType<Orchestrator["replan"]>
      >;
      const created = result.created[0]!;
      const view = yield* read(orchestrator, b.id);
      expect(view.dependsOn).toEqual([created.taskId]);
      expect(view.status).toBe("waiting");
    }),
  ));

it("keeps a task, resumes it in a new thread, and puts the memo in the prompt", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator, workers } = setup();
      const a = yield* create(orchestrator, {
        title: "a",
        currentState: "a is not written",
        goalState: "a works",
      });

      const pending = replan(orchestrator, { reason: "same plan", keep: [a.id] });
      yield* stopAndWrapUp(orchestrator, [workers[0]!], "two checks still failing");

      const result = (yield* Effect.promise(() => pending)) as Awaited<
        ReturnType<Orchestrator["replan"]>
      >;
      expect(result.kept).toEqual([a.id]);
      expect(result.started).toEqual([a.id]);
      yield* waitFor(() => workers.length === 2);
      expect(workers[1]?.prompts[0]).toContain("a is not written");
      expect(workers[1]?.prompts[0]).toContain("a works");
      expect(workers[1]?.prompts[0]).toContain("two checks still failing");
      expect(taskStatus(orchestrator, a.id)).toBe("running");
    }),
  ));

it("closes a dropped task with its reason and lets the round review go", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator, workers } = setup();
      const a = yield* create(orchestrator, {
        title: "a",
        currentState: "a is not written",
        goalState: "a works",
      });
      const b = yield* create(orchestrator, {
        title: "b",
        currentState: "b is not written",
        goalState: "b works",
        dependsOn: [a.id],
      });

      const pending = replan(orchestrator, {
        reason: "a covers b",
        keep: [a.id],
        drop: [{ taskId: b.id, reason: "a already does it" }],
      });
      yield* stopAndWrapUp(orchestrator, [workers[0]!], "a is done");

      const result = (yield* Effect.promise(() => pending)) as Awaited<
        ReturnType<Orchestrator["replan"]>
      >;
      expect(result.dropped).toEqual([{ taskId: b.id, title: "b", reason: "a already does it" }]);
      const dropped = yield* read(orchestrator, b.id);
      expect(dropped.status).toBe("stopped");
      expect(dropped.reports.at(-1)?.content).toContain("a already does it");
      const review = orchestrator.snapshot.tasks.find((task) => task.kind === "review");
      expect(review?.dependsOn).not.toContain(b.id);
    }),
  ));

it("merges several tasks into one and carries their states and memo", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator, workers } = setup();
      const a = yield* create(orchestrator, {
        title: "a",
        currentState: "a is not written",
        goalState: "a works",
      });
      const b = yield* create(orchestrator, {
        title: "b",
        currentState: "b is not written",
        goalState: "b works",
        dependsOn: [a.id],
      });

      const pending = replan(orchestrator, {
        reason: "a and b are one change",
        tasks: [{ from: [a.id, b.id], title: "ab" }],
      });
      yield* stopAndWrapUp(orchestrator, [workers[0]!], "half of a is done");

      const result = (yield* Effect.promise(() => pending)) as Awaited<
        ReturnType<Orchestrator["replan"]>
      >;
      const merged = result.created[0]!;
      expect(merged.from).toEqual([a.id, b.id]);
      expect(taskStatus(orchestrator, a.id)).toBe("stopped");
      expect(taskStatus(orchestrator, b.id)).toBe("stopped");
      yield* waitFor(() => workers.length === 2);
      expect(workers[1]?.prompts[0]).toContain("a is not written");
      expect(workers[1]?.prompts[0]).toContain("b is not written");
      expect(workers[1]?.prompts[0]).toContain("a works");
      expect(workers[1]?.prompts[0]).toContain("b works");
      expect(workers[1]?.prompts[0]).toContain("half of a is done");
      const view = yield* read(orchestrator, merged.taskId);
      expect(view.dependsOn).toEqual([]);
    }),
  ));

it("rewires waiting work without stopping anything when stop is false", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator, workers } = setup();
      const a = yield* create(orchestrator, {
        title: "a",
        currentState: "a is not written",
        goalState: "a works",
      });
      const b = yield* create(orchestrator, {
        title: "b",
        currentState: "b is not written",
        goalState: "b works",
        dependsOn: [a.id],
      });

      const result = yield* Effect.promise(() =>
        orchestrator.replan({
          reason: "b needs the split first",
          stop: false,
          keep: [a.id, b.id],
          tasks: [
            {
              key: "half",
              title: "half",
              currentState: "half is not written",
              goalState: "half works",
              dependsOn: [a.id],
            },
          ],
          rewire: [{ taskId: b.id, dependsOn: ["half"] }],
        }),
      );
      expect(result.stopped).toEqual([]);
      expect(result.created).toHaveLength(1);
      expect(workers[0]?.prompts).toHaveLength(1);
      expect(taskStatus(orchestrator, a.id)).toBe("running");
      const view = yield* read(orchestrator, b.id);
      expect(view.dependsOn).toEqual([result.created[0]!.taskId]);
    }),
  ));
