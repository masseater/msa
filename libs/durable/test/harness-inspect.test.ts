import { defineTask, type TaskId, type TaskInspection } from "@msa/durable";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { chatSetup, openChat, unanswered, waitFor } from "./chat-support.ts";
import { awaited } from "./effect-support.ts";
import { context } from "./session-support.ts";
import { completed, type Deferred, deferred, eventually, openTasks } from "./task-support.ts";

type Step = { phase: "run" };

function task(
  name: string,
  version: number,
  options: { gate?: Promise<void>; migrate?: () => void } = {},
) {
  const migrate = options.migrate;
  return defineTask<null, Step, null>({
    name,
    version,
    initial: () => ({ phase: "run" }),
    phases: {
      run: (_task, runtime, ctx) =>
        Effect.runPromise(
          Effect.gen(function* () {
            yield* awaited(options.gate);
            yield* awaited(runtime.commit(() => completed(null), ctx));
          }),
        ),
    },
    abort: () => Promise.resolve(),
    ...(migrate === undefined
      ? {}
      : {
          migrate: () => {
            migrate();
            return { input: null, checkpoint: { phase: "run" as const } };
          },
        }),
  });
}

function stateOf(
  tasks: readonly TaskInspection[],
  id: TaskId,
): TaskInspection["state"] | undefined {
  return tasks.find((entry) => entry.record.id === id)?.state;
}

type Gated = { gateId?: TaskId };

function dependentOn(gated: Gated) {
  return defineTask<null, { phase: "wait" } | { phase: "done" }, null>({
    name: "test.dependent",
    version: 1,
    initial: () => ({ phase: "wait" }),
    phases: {
      wait: (_task, runtime, ctx) =>
        Effect.runPromise(
          Effect.gen(function* () {
            const checkpoint = { phase: "done" } as const;
            yield* awaited(
              runtime.commit(
                () => ({
                  status: "waiting",
                  checkpoint,
                  on: [gated.gateId!],
                  policy: "allSettled",
                }),
                ctx,
              ),
            );
          }),
        ),
      done: (_task, runtime, ctx) => Promise.resolve(runtime.commit(() => completed(null), ctx)),
    },
    abort: () => Promise.resolve(),
  });
}

function registeredTasks(
  Gate: ReturnType<typeof task>,
  Dependent: ReturnType<typeof dependentOn>,
  counts: { migrations: number },
) {
  return [
    Gate,
    Dependent,
    task("test.migrating", 2, {
      migrate: () => {
        counts.migrations++;
      },
    }),
    task("test.no-migration", 2),
    task("test.failing", 2, {
      migrate: () => {
        throw new Error("cannot migrate");
      },
    }),
    task("test.too-old", 1),
  ];
}

const openInspected = Effect.fn("openInspected")(function* (gate: Deferred<void>) {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const Gate = task("test.gate", 1, { gate: gate.promise });
  const gated: Gated = {};
  const Dependent = dependentOn(gated);
  const counts = { migrations: 0 };
  const { harness } = yield* openTasks(
    new MemoryStorage(),
    registeredTasks(Gate, Dependent, counts),
  );
  const root = yield* awaited(harness.root(context));
  const ids = yield* awaited(
    root.commit(
      (tx) =>
        runPromise(
          Effect.gen(function* () {
            const gateId = yield* awaited(
              tx.createTask(Gate, null, { ownership: { kind: "conversation" } }),
            );
            gated.gateId = gateId;
            return {
              gate: gateId,
              dependent: yield* awaited(
                tx.createTask(Dependent, null, { ownership: { kind: "conversation" } }),
              ),
              migrating: yield* awaited(
                tx.createTask(task("test.migrating", 1), null, {
                  ownership: { kind: "conversation" },
                }),
              ),
              noMigration: yield* awaited(
                tx.createTask(task("test.no-migration", 1), null, {
                  ownership: { kind: "conversation" },
                }),
              ),
              failing: yield* awaited(
                tx.createTask(task("test.failing", 1), null, {
                  ownership: { kind: "conversation" },
                }),
              ),
              tooOld: yield* awaited(
                tx.createTask(task("test.too-old", 2), null, {
                  ownership: { kind: "conversation" },
                }),
              ),
              missing: yield* awaited(
                tx.createTask(task("test.missing", 1), null, {
                  ownership: { kind: "conversation" },
                }),
              ),
            };
          }),
        ),
      context,
    ),
  );
  return { harness, ids, counts };
});

function expectPausedStates(
  paused: Awaited<
    ReturnType<Effect.Success<ReturnType<typeof openInspected>>["harness"]["inspect"]>
  >,
  ids: Effect.Success<ReturnType<typeof openInspected>>["ids"],
) {
  expect(paused.scheduling).toBe("paused");
  expect(paused.tasks.map((entry) => entry.record.id)).toEqual(Object.values(ids));
  expect(stateOf(paused.tasks, ids.gate)).toEqual({ kind: "ready", migrates: false });
  expect(stateOf(paused.tasks, ids.dependent)).toEqual({ kind: "ready", migrates: false });
  expect(stateOf(paused.tasks, ids.migrating)).toEqual({ kind: "ready", migrates: true });
  expect(stateOf(paused.tasks, ids.failing)).toEqual({ kind: "ready", migrates: true });
  expect(stateOf(paused.tasks, ids.noMigration)).toMatchObject({
    kind: "blocked",
    reason: "migration_failed",
    error: new Error("Task test.no-migration version 2 has no migration from 1"),
  });
  expect(stateOf(paused.tasks, ids.tooOld)).toEqual({ kind: "blocked", reason: "task_too_old" });
  expect(stateOf(paused.tasks, ids.missing)).toEqual({ kind: "blocked", reason: "missing_task" });
}

const derivesEveryLive = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const gate = deferred();
  const { harness, ids, counts } = yield* openInspected(gate);

  expectPausedStates(yield* awaited(harness.inspect(context)), ids);
  expect(counts.migrations).toBe(0);
  expect((yield* awaited(harness.inspect(context))).scheduling).toBe("paused");

  harness.resume();
  yield* eventually(() => counts.migrations === 1);
  yield* awaited(harness.waitForTask(ids.migrating, context));
  let running = yield* awaited(harness.inspect(context));
  yield* waitFor(() =>
    runPromise(
      Effect.gen(function* () {
        running = yield* awaited(harness.inspect(context));
        return (
          stateOf(running.tasks, ids.gate)?.kind === "running" &&
          stateOf(running.tasks, ids.dependent)?.kind === "waiting"
        );
      }),
    ),
  );
  expect(stateOf(running.tasks, ids.dependent)).toEqual({ kind: "waiting", on: [ids.gate] });
  expect(running.scheduling).toBe("running");
  expect(stateOf(running.tasks, ids.gate)).toEqual({ kind: "running" });
  expect(stateOf(running.tasks, ids.migrating)).toBeUndefined();
  expect(stateOf(running.tasks, ids.failing)).toEqual({
    kind: "blocked",
    reason: "migration_failed",
    error: new Error("cannot migrate"),
  });

  gate.resolve();
  yield* awaited(harness.waitForTask(ids.dependent, context));
  const settled = yield* awaited(harness.inspect(context));
  expect(settled.tasks.map((entry) => entry.record.id)).toEqual([
    ids.noMigration,
    ids.failing,
    ids.tooOld,
    ids.missing,
  ]);
  yield* awaited(harness.close(context));
});

describe("Harness.inspect()", () => {
  it("derives every live task's state without running task code", () =>
    Effect.runPromise(derivesEveryLive));
});

const listsUnsettledSubmissions = Effect.gen(function* () {
  const setup = chatSetup();
  const busy = unanswered();
  setup.faux.setResponses([busy.step]);
  const { harness, root } = yield* openChat(new MemoryStorage(), setup);
  const other = yield* awaited(
    harness.createConversation({ ownership: { kind: "ownerless" } }, context),
  );
  yield* awaited(other.submit({ type: "write", entry: { kind: "note" } }, context));
  const input = yield* awaited(root.submit({ type: "input", content: "hi" }, context));
  yield* awaited(busy.reached);

  const inspection = yield* awaited(harness.inspect(context));
  expect(inspection.submissions).toEqual([yield* awaited(input.status(context))]);
  expect(inspection.tasks.map((entry) => [entry.record.kind, entry.state.kind])).toEqual([
    ["msa.generation", "running"],
  ]);
  yield* awaited(harness.close(context));
});

describe("Harness.inspect()", () => {
  it("lists unsettled submissions", () => Effect.runPromise(listsUnsettledSubmissions));
});
